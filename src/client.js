'use strict';

const moment = require('moment-timezone');
const rp = require('request-promise');

const AWS = require('aws-sdk');

const dynamoClient = new AWS.DynamoDB.DocumentClient({region: process.env.APP_REGION});

const common = require("trash-common");
const logger = common.getLogger();
logger.LEVEL = process.env.RUNLEVEL === "INFO" ? logger.INFO : logger.DEBUG;

const crypto = require("crypto");
const MessagePack = require("what-the-pack");
const {encode,decode} = MessagePack.initialize(2**22);

const toHash = (value) => {
    return crypto.createHash("sha512").update(value).digest("hex");
}
class Client {
    constructor(_timezone, _text_creator){
        this.timezone = _timezone || 'utc';
        this.textCreator = _text_creator;
    }

    /**
    access_token: アクセストークン
    target_day: 0:今日,1:明日
    **/
    static async getTrashData(access_token) {
        try {
            let user_id = access_token
            // 非互換用のチェック条件,access_tokenが36桁の場合はuser_idとみなして直接TrashScheduleを検索する
            if(access_token.length != 36) {
                const accessTokenOption = {
                    TableName: "throwtrash-backend-accesstoken",
                    Key: {
                        access_token: toHash(access_token)
                    }
                }; 
                const tokenData = await dynamoClient.get(accessTokenOption).promise();
                logger.debug(JSON.stringify(tokenData));
                user_id = tokenData.Item ? tokenData.Item.user_id : undefined
            }

            if(user_id) {
                const params = {
                    TableName: 'TrashSchedule',
                    Key: {
                        id: user_id
                    }
                };
                const scheduleData = await dynamoClient.get(params).promise();
                logger.debug(JSON.stringify(scheduleData));
                if (scheduleData.Item) {
                    return {
                        status: 'success',
                        response: JSON.parse(scheduleData.Item.description)
                    };
                }
            }
            logger.error(`User Not Found(AccessToken: ${access_token})`);
            return {
                status: 'error',
                msgId: 'id_not_found_error'
            };
        } catch(err) {
            logger.error(err);
            return {
                    status:'error',
                    msgId: 'general_error'
            };
        }
    }

    /**
    target_day: 対象とする日を特定するための値。0なら今日、1なら明日……となる。
    **/
    calculateLocalTime(target_day) {
        const utcdt = new Date(); //UTC時刻
        const localeoffset = moment.tz.zone(this.timezone).utcOffset(utcdt.getTime());
        // 稼働するロケールのオフセットを差し引くことで、new Date(localtime)のロケールのオフセットを打ち消す
        const localtime = utcdt.getTime() + (utcdt.getTimezoneOffset() * 60 * 1000) + ((-1 * localeoffset) * 60 * 1000) + (60 * 24 * 60 * 1000 * target_day);
        const dt = new Date(localtime);
        return dt;
    }

    /**
     * 計算対象日を求める
     * 指定された曜日が現時点から何日後かを返す
    **/
    getTargetDayByWeekday(target_weekday) {
        const dt = this.calculateLocalTime(0);
        const now_weekday = dt.getDay();
        let target_day = target_weekday - now_weekday;
        //1より小さい場合は翌週分
        if(target_day < 1) {
            target_day += 7;
        }
        return target_day;
    }

    async getEnableTrashData(trash,dt) {
        const trash_name = trash['type'] ==='other' ? trash['trash_val'] : this.textCreator.getTrashName(trash['type']);
        const trash_data = {
            type: trash['type'],
            name: trash_name
        };

        const check = (schedule)=>{
            if(schedule['type'] === 'weekday') {
                if(Number(schedule['value']) === dt.getDay()) {
                    return true;
                }
            } else if(schedule['type'] === 'biweek') {
                var matches = schedule['value'].match(/(\d)-(\d)/);
                var weekday = Number(matches[1]);
                var turn = Number(matches[2]);

                // 現在何週目かを求める
                var nowturn = 0;
                var targetdate = dt.getDate();
                while(targetdate > 0) {
                    nowturn += 1;
                    targetdate -= 7;
                }

                if(weekday === dt.getDay() && turn === nowturn) {
                    return true;
                }
            } else if(schedule['type'] === 'month') {
                if(dt.getDate() === Number(schedule['value'])) {
                    return true;
                }
            } else if(schedule['type'] === 'evweek') {
                if(Number(schedule.value.weekday) === dt.getDay()) {
                    const start_dt = new Date(schedule.value.start);
                    start_dt.setHours(0);
                    start_dt.setMinutes(0);
                    start_dt.setSeconds(0);
                    start_dt.setMilliseconds(0);

                    // 今週の日曜日を求める
                    let current_dt = new Date(dt.toISOString());
                    current_dt.setHours(0);
                    current_dt.setMinutes(0);
                    current_dt.setSeconds(0);
                    current_dt.setMilliseconds(0);
                    current_dt.setDate(current_dt.getDate() - current_dt.getDay());

                    // 登録されている日付からの経過日数を求める
                    const past_date = (current_dt - start_dt) / 1000 / 60 / 60 / 24;

                    // 差が0またはあまりが0であれば隔週に該当
                    trash_data.schedule = [];
                    if(past_date === 0 || (past_date / 7) % 2 === 0) {
                        return true;
                    }
                }
            }
        }
        if(trash['schedules'].some(check)) {
            return trash_data;
        }
        return {};
    }

    /**
    trashes:   DynamoDBから取得したJSON形式のパラメータ。
    target_day: チェックするn日目。0なら今日、1なら明日......
    **/
    async checkEnableTrashes(trashes,target_day) {
        const dt = this.calculateLocalTime(target_day);
        let promise_list = [];
        trashes.forEach((trash) => {
            promise_list.push(
                this.getEnableTrashData(trash,dt)
            );
        });
        const result = await Promise.all(promise_list);
        logger.debug('CheckEnableTrashes result:'+JSON.stringify(result));
        // 同名のゴミがあった場合に重複を排除する
        const keys = [];
        return result.filter((value)=>{
            const key = value.type+value.name;
            if(!value.type || keys.indexOf(key) >= 0) {
                return false;
            } else {
                keys.push(key);
                return true;
            }
        });
    }

    /**
     * スケジュールの種類と値に従い今日から最も近い 日にちを返す。
     * @param {Date} today タイムゾーンを考慮した今日の日付
     * @param {String} schedule_type スケジュールの種類
     * @param {String} schedule_val スケジュールの値
     * @returns {Date} 条件に合致する直近の日にち
     */
    calculateNextDateBySchedule(today, schedule_type, schedule_val) {
        let next_dt = new Date(today.getTime());
        if(schedule_type === 'weekday') {
            let diff_day = Number(schedule_val) - today.getDay();
            diff_day < 0 ? next_dt.setDate(today.getDate() + (7 + diff_day)) : next_dt.setDate(today.getDate() + diff_day);
        } else if ((schedule_type === 'month')) {
            let now_date = today.getDate();
            while(now_date != schedule_val) {
                // スケジュールと現在の日にちの差分を取る
                let diff_date = Number(schedule_val) - now_date;
                if(diff_date < 0) {
                    // 現在日>設定日の場合は翌月の1日をセットする
                    next_dt.setMonth(next_dt.getMonth() + 1);
                    next_dt.setDate(1);
                    logger.info(next_dt);
                } else {
                    // 現在日<設定日の場合は差分の分だけ日にちを進める
                    next_dt.setDate(next_dt.getDate() + diff_date);
                }
                now_date = next_dt.getDate();
            }
        } else if(schedule_type === 'biweek') {
            // 設定値
            const matches = schedule_val.match(/(\d)-(\d)/);
            const weekday = Number(matches[1]);
            const turn = Number(matches[2]);

            // 直近の同じ曜日の日にちを設定
            let diff_day = weekday - today.getDay();
            diff_day < 0 ? next_dt.setDate(today.getDate() + (7 + diff_day)) : next_dt.setDate(today.getDate() + diff_day);

            // 何週目かを求める
            let nowturn = 0;
            let targetdate = next_dt.getDate();
            while(targetdate > 0) {
                nowturn += 1;
                targetdate -= 7;
            }

            let current_month = next_dt.getMonth();
            while(turn != nowturn) {
                next_dt.setDate(next_dt.getDate()+7);
                if(current_month != next_dt.getMonth()) {
                    nowturn = 1;
                    current_month = next_dt.getMonth();
                } else {
                    nowturn += 1;
                }
            }
        } else if(schedule_type === 'evweek') {
            const start_dt = new Date(schedule_val.start);
            start_dt.setHours(0);
            start_dt.setMinutes(0);
            start_dt.setSeconds(0);
            start_dt.setMilliseconds(0);

            // 直近の同じ曜日の日にちを設定
            let diff_date = Number(schedule_val.weekday) - today.getDay();
            diff_date < 0 ? next_dt.setDate(today.getDate() + (7 + diff_date)) : next_dt.setDate(today.getDate() + diff_date);

            // 直近の同じ曜日の日にちの日曜日を取得
            let current_dt = new Date(next_dt.getTime());
            current_dt.setHours(0);
            current_dt.setMinutes(0);
            current_dt.setSeconds(0);
            current_dt.setMilliseconds(0);
            current_dt.setDate(current_dt.getDate() - current_dt.getDay());

            // 登録されている日付からの経過日数を求める
            const past_date = (current_dt - start_dt) / 1000 / 60 / 60 / 24;

            // 差が0以外かつあまりが0でなければ1週間進める
            if(past_date != 0 && (past_date / 7) % 2 != 0) {
                next_dt.setDate(next_dt.getDate()+7);
            }
        }
        return next_dt;
    }

    /*
    指定したごみの種類から直近のゴミ捨て日を求める
    trashes: DynamoDBから取得したJSON形式のパラメータ
    target_type: ごみの種類
    */
   /**
    * 指定したごみの種類から直近のゴミ捨て日を求める。
    * trashesの中に同一のゴミ（typeが同じ）があれば一つにまとめる。ただしtypeがotherの場合のみゴミの名前（trash_val）で区別するため、戻り値のkeyは複数になる可能性がある。
    * @param {Array} trashes DynamoDBから取得した登録済みごみ出し予定
    * @param {string}} target_type 検索するゴミの種類
    * @returns {object} target_typeで指定されたゴミの直近の予定日プロパティ。{key:ゴミの種類,schedules:登録されているごみ出し予定,list:登録スケジュールから算出した直近の予定日,recent: listの中で最も近い日}
    */
    getDayFromTrashType(trashes,target_type) {
        logger.debug('getDayFromTrashType:'+JSON.stringify(trashes)+',type:'+target_type);
        const match_dates = {}
        trashes.forEach((trash)=>{
            if(trash.type === target_type) {
                const key = trash.type === 'other' ? trash.trash_val : trash.type;
                // schedules:登録されているスケジュール,list:登録スケジュールに対応する直近の日にち,recent:listのうち最も近い日にち
                if(!match_dates[key]) match_dates[key] = {schedules: trash.schedules,list: [],recent: null};
            }
        });

        const today_dt = this.calculateLocalTime(0);
        Object.keys(match_dates).forEach((key)=>{
            const match_data = match_dates[key];
            let recently = new Date('9999/12/31');
            match_data.schedules.forEach((schedule)=>{
                const next_dt = this.calculateNextDateBySchedule(today_dt,schedule.type,schedule.value);
                if(recently.getTime() > next_dt.getTime()) {
                    recently =  new Date(next_dt.getTime());
                }
                match_data.list.push(next_dt);
            });
            match_data.recent = recently;
        });
        logger.debug('GetDayFromTrashType result:');
        logger.debug(match_dates);
        return match_dates;
    }

    /**
     * 
     * @param {Number} target_week  0:今週, 1:来週
     * @returns {Array} {target_day: オブジェクト配列
     */
    async getRemindBody(target_week, trash_data) {
        const result_list = [];
        const today_dt = this.calculateLocalTime(0);
        const weekNum = today_dt.getDay()
        if(target_week === 0) {
            // 今週の場合は明日以降の土曜日までの日にちを算出する
            for(let i=0; i<(6 - weekNum); i++) {
                const target_day = i+1;
                const result = await this.checkEnableTrashes(trash_data, target_day)
                result_list.push({
                    target_day: target_day,
                    body: result
                });
            }
        } else if(target_week === 1) {
            const padding_date = 7 - weekNum;
            // 来週の場合は次の日曜日を求める
            for(let i=0; i<7; i++) {
                const target_day = i+padding_date
                const result = await this.checkEnableTrashes(trash_data, target_day);
                result_list.push({
                    target_day:  target_day,
                    body: result
                });
            }
        }
        return result_list;
    }

    static async compareTwoText(text1, text2) {
        if(text1 && text2) {
            const option = {
                uri: process.env.MecabAPI_URL + '/compare',
                qs: {
                    word1: text1,
                    word2: text2
                },
                encoding: null
            };
            return rp(option).then(response => {
                return decode(response);
            }).catch(err => {
                logger.error(err);
                throw err;
            });
        }
        logger.error(`Compare invalid parameter:${text1},${text2}`);
        return Promise.reject('err');
    }
}

module.exports = Client;