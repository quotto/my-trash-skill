const assert = require('assert');
const sinon = require('sinon');
const rewire = require('rewire');
const rp = require('request-promise');
const crypto = require("crypto");

const common = require("trash-common");
const logger = common.getLogger();
logger.LEVEL =  logger.DEBUG;

process.env.APP_REGION = "us-west-2";
const Client = rewire('../client.js');
const testData = require('./testdata.json');
const TextCreator = require('../common/text-creator.js');
const locale_list = ['ja-JP', 'en-US'];
const localeText={}, commonText={}, displayText={};
locale_list.forEach(locale=>{
    localeText[locale] = require(`../common/template_text/${locale}.text.json`);
    commonText[locale] = require(`../common/template_text/${locale}.common.json`);
    displayText[locale] = require(`../common/template_text/${locale}.display.json`);
});


describe('Client,en-US',function(){
    it('checkEnableTrashes',async()=>{
        const client = new Client('America/New_York', new TextCreator('en-US'));
        const stub = sinon.stub(client,'calculateLocalTime');
        stub.withArgs(0).returns(new Date('2018/03/01'));
        try {
            const testdata = [ { 'type': 'burn','trash_val': '', 'schedules': [ { 'type': 'weekday', 'value': '3' }, { 'type': 'weekday', 'value': '6' }, { 'type': 'none', 'value': '' } ] }, { 'type': 'plastic', 'trash_val': '','schedules': [ { 'type': 'weekday', 'value': '1' }, { 'type': 'none', 'value': '' }, { 'type': 'none', 'value': '' } ] }, { 'type': 'paper','trash_val': '', 'schedules': [ { 'type': 'none', 'value': '' }, { 'type': 'biweek', 'value': '1-2' }, { 'type': 'none', 'value': '' } ]}, { 'type': 'plastic', 'trash_val': '','schedules': [ { 'type': 'weekday', 'value': '4' }, { 'type': 'none', 'value': '' }, { 'type': 'none', 'value': '' } ] }, { 'type': 'petbottle', 'trash_val': '','schedules': [ { 'type': 'weekday', 'value': '4' }, { 'type': 'month', 'value': '11' }, { 'type': 'none', 'value': '' } ] } ];

            try{
                let result = await client.checkEnableTrashes(testdata,0);
                assert.equal(result.length,2);
                assert.equal(result[0].name,'plastic');
                assert.equal(result[1].name,'plastic bottle');
            } finally{
                stub.restore();
            }
        } finally {
            stub.restore();
        }
    });
});

describe('calculateLocalTime',()=>{
    let stub;
    before(()=>{
        stub = sinon.stub(Date.prototype,'getTime');
        stub.withArgs().returns(1554298037605); //2019/4/3 13h
    });
    it('calculateTime',()=>{
        let dt;
        let client;
        client = new Client('America/Denver', new TextCreator('en-US'));
        dt = client.calculateLocalTime(0);
        assert.equal(dt.getHours(),7);

        client = new Client('America/Boise', new TextCreator('en-US'));
        dt = client.calculateLocalTime(0);
        assert.equal(dt.getHours(),7);

        client = new Client('America/Phoenix', new TextCreator('en-US'));
        dt = client.calculateLocalTime(0);
        assert.equal(dt.getHours(),6);

        client = new Client('America/Los_Angeles', new TextCreator('en-US'));
        dt = client.calculateLocalTime(0);
        assert.equal(dt.getHours(),6);

        client = new Client('America/Chicago', new TextCreator('en-US'));
        dt = client.calculateLocalTime(0);
        assert.equal(dt.getHours(),8);

        client = new Client('America/Indiana/Indianapolis', new TextCreator('en-US'));
        dt = client.calculateLocalTime(0);
        assert.equal(dt.getHours(),9);

        client = new Client('America/Detroit', new TextCreator('en-US'));
        dt = client.calculateLocalTime(0);
        assert.equal(dt.getHours(),9);

        client = new Client('America/New_York', new TextCreator('en-US'));
        dt = client.calculateLocalTime(0);
        assert.equal(dt.getHours(),9);

        client = new Client('America/Anchorage', new TextCreator('en-US'));
        dt = client.calculateLocalTime(0);
        assert.equal(dt.getHours(),5);

        client = new Client('Pacific/Honolulu', new TextCreator('en-US'));
        dt = client.calculateLocalTime(0);
        assert.equal(dt.getHours(),3);


        client = new Client('Asia/Tokyo', new TextCreator('en-US'));
        dt = client.calculateLocalTime(0);
        assert.equal(dt.getHours(),22);


        client = new Client('utc', new TextCreator('en-US'));
        dt = client.calculateLocalTime(0);
        assert.equal(dt.getHours(),13);
    });
    after(()=>{
        stub.restore();
    });
});

describe('Client,ja-JP',function(){
    let client;
    let nict_data;
    before((done)=>{
        client = new Client('Asia/Tokyo', new TextCreator('ja-JP'));
        rp.get('https://ntp-a1.nict.go.jp/cgi-bin/json').then((data)=>{
            nict_data = JSON.parse(data);
            done();
        })
    });
    describe('calculateLocalTime',function(){
        it('今日の日付',function(){
            const ans = new Date(nict_data.st * 1000 + (9*60*60*1000));
            let dt = client.calculateLocalTime(0);
            assert.equal(dt.getDate(),ans.getUTCDate());
            assert.equal(dt.getDay(),ans.getUTCDay());
        });

        it('明日の日付',function(){
            const ans = new Date(nict_data.st * 1000 + (9*60*60*1000));
            ans.setSeconds(ans.getSeconds()+(24*60*60));
            let dt = client.calculateLocalTime(1);
            assert.equal(dt.getDate(),ans.getUTCDate());
            assert.equal(dt.getDay(),ans.getUTCDay());
        });
    });

    describe('checkEnableTrashes',function(){
        const client = new Client('Asia/Tokyo', new TextCreator('ja-JP'));
        it('weekday',async()=>{
            const stub = sinon.stub(client,'calculateLocalTime');
            stub.withArgs(0).returns(new Date('2018/03/01'));

            try{
                let result = await client.checkEnableTrashes(testData.checkEnableTrashes,0);
                assert.equal(result.length,2);
                assert.equal(result[0].name,'ビン、カン');
                assert.equal(result[1].name,'ペットボトル');
            } finally{
                stub.restore();
            }

        });
        it('biweek',async()=>{
            const stub = sinon.stub(client,'calculateLocalTime');
            stub.withArgs(0).returns(new Date('2018/03/12'));

            try{
                let result = await client.checkEnableTrashes(testData.checkEnableTrashes,0);
                assert.equal(2,result.length);
                assert.equal('プラスチック',result[0].name);
                assert.equal('古紙',result[1].name);
            } finally{
                stub.restore();
            }
        });
        it('month',async()=>{
            const stub = sinon.stub(client,'calculateLocalTime');
            stub.withArgs(0).returns(new Date('2018/03/11'));

            try{
                let result = await client.checkEnableTrashes(testData.checkEnableTrashes,0);
                assert.equal(result.length,1);
                assert.equal(result[0].name,'ペットボトル');
            }finally{
                stub.restore();
            }
        });
        it('evweek',async()=>{
            const stub = sinon.stub(client,'calculateLocalTime');
            stub.withArgs(0).returns(new Date('2018-09-26'));

            /**
             * テストデータの想定(testdata.jsonのevweek)
             * 1.曜日が一致し該当週のため対象
             * 2.曜日が一致し該当週のため対象(年をまたいだ隔週判定)
             * 3.該当集だが曜日が一致しないので対象外
             * 4.登録週=今週かつ曜日が一致のため対象
             * 5.翌週が該当週のため対象外
             * 6.前週が該当のため対象外
             * 7.4週間前のため一致
             */
            try{
                const result = await client.checkEnableTrashes(testData.evweek,0);
                assert.equal(result.length,4);
                assert.equal(result[0].name,'もえるゴミ');
                assert.equal(result[1].name,'もえないゴミ');
                assert.equal(result[2].name,'プラスチック');
                assert.equal(result[3].name,'ビン');
            }finally {
                stub.restore();
            }
        });
        it('none',async()=>{
            const client = new Client('Asia/Tokyo', new TextCreator('ja-JP'));
            const stub = sinon.stub(client,'calculateLocalTime');
            stub.withArgs(0).returns(new Date('2018/03/04'));

            try{
                let result = await client.checkEnableTrashes(testData.checkEnableTrashes,0);
                assert.equal(0,result.length);
            } finally {
                stub.restore();
            }
        });
    });
    describe('checkEnableTrashes duplicate 重複排除機能',function(){
        it('重複の排除',async()=>{
            const client = new Client('Asia/Tokyo', new TextCreator('ja-JP'));
            const stub = sinon.stub(client,'calculateLocalTime');
            stub.withArgs(0).returns(new Date('2018-09-29 00:00'));

            const response = await client.checkEnableTrashes(testData.duplicate,0);
            assert.equal(response.length,1);

            stub.restore();
        });
        it('otherの場合はtrash_valが同じ場合のみ重複排除',async()=>{
            const stub = sinon.stub(client,'calculateLocalTime');
            stub.withArgs(0).returns(new Date('2018-08-26 00:00'));

            let response = await client.checkEnableTrashes(testData.duplicate_other,0);
            assert.equal(response.length,2);
            assert.equal(response[0].name,'廃品');
            assert.equal(response[1].name,'発泡スチロール');

            stub.restore();
        });
    });
    describe('getTargetDayByWeekday',function(){
        let stub;
        let client;
        before(()=>{
            client = new Client('Asia/Tokyo', new TextCreator('ja-JP'));
            stub = sinon.stub(client,'calculateLocalTime');
            stub.withArgs(0).returns(new Date('2019/03/17'));
        });
        it('日曜日',function(){
            const target_day = client.getTargetDayByWeekday(0);
            assert.equal(target_day,7);
        });
        it('月曜日',function(){
            const target_day = client.getTargetDayByWeekday(1);
            assert.equal(target_day,1);
        });
        it('土曜日',function(){
            const target_day = client.getTargetDayByWeekday(6);
            assert.equal(target_day,6);
        });
        after(()=> {
            stub.restore();
        });
    });

    describe('calculateNextDayBySchedule',()=>{
        const client = new Client('Asia/Tokyo', new TextCreator('ja-JP'));
        const today = new Date('2019/11/27'); //水曜日
        it('weekday:当日',()=>{
            const next_dt = client.calculateNextDateBySchedule(today, 'weekday', '3')
            assert.equal(next_dt.getDate(), 27);
        });
        it('weekday:同じ週',()=>{
            const next_dt = client.calculateNextDateBySchedule(today, 'weekday', '6')
            assert.equal(next_dt.getDate(), 30);
        });
        it('weekday:次の週',()=>{
            const next_dt = client.calculateNextDateBySchedule(new Date('2019//11/20'), 'weekday', '2')
            assert.equal(next_dt.getDate(), 26);
        });
        it('weekday:月替り',()=>{
            const next_dt = client.calculateNextDateBySchedule(new Date('2019//11/27'), 'weekday', '2')
            assert.equal(next_dt.getMonth(), 11);
            assert.equal(next_dt.getDate(), 3);
        });

        it('month:当日',()=>{
            const next_dt = client.calculateNextDateBySchedule(today, 'month', 27);
            assert.equal(next_dt.getDate(), 27);
        });
        it('month:同じ月',()=>{
            const next_dt = client.calculateNextDateBySchedule(today, 'month', 29);
            assert.equal(next_dt.getDate(), 29);
        });
        it('month:月替り',()=>{
            const next_dt = client.calculateNextDateBySchedule(today, 'month', 1);
            assert.equal(next_dt.getMonth(), 11);
            assert.equal(next_dt.getDate(), 1);
        });

        it('biweek:当日',()=>{
            const next_dt = client.calculateNextDateBySchedule(new Date('2019/11/22'), 'biweek', '5-4');
            assert.equal(next_dt.getDate(), 22);

        });
        it('biweek:同じ週',()=>{
            const next_dt = client.calculateNextDateBySchedule(new Date('2019/11/22'), 'biweek', '6-4');
            assert.equal(next_dt.getDate(), 23);
        });
        it('biweek:次の週',()=>{
            const next_dt = client.calculateNextDateBySchedule(new Date('2019/11/22'), 'biweek', '0-4');
            assert.equal(next_dt.getDate(), 24);
        });
        it('biweek月替り',()=>{
            const next_dt = client.calculateNextDateBySchedule(new Date('2019/11/22'), 'biweek', '0-1');
            assert.equal(next_dt.getMonth(), 11);
            assert.equal(next_dt.getDate(), 1);
        });

        it('evweek:当日', ()=>{
            const next_dt = client.calculateNextDateBySchedule(new Date('2019/11/22'), 'evweek', {start: '2019-11-17',weekday: '5'});
            assert.equal(next_dt.getDate(), 22);
        })
        it('evweek:同じ週', ()=>{
            const next_dt = client.calculateNextDateBySchedule(new Date('2019/11/21'), 'evweek', {start: '2019-11-3',weekday: '5'});
            assert.equal(next_dt.getDate(), 22);
        })
        it('evweek:次の週', ()=>{
            const next_dt = client.calculateNextDateBySchedule(new Date('2019/11/21'), 'evweek', {start: '2019-11-10',weekday: '5'});
            assert.equal(next_dt.getDate(), 29);
        })
        it('evweek:開始が未来日', ()=>{
            const next_dt = client.calculateNextDateBySchedule(new Date('2019/11/21'), 'evweek', {start: '2019-11-24',weekday: '5'});
            assert.equal(next_dt.getDate(), 29);
        })
        it('evweek:月替り', ()=>{
            const next_dt = client.calculateNextDateBySchedule(new Date('2019/11/21'), 'evweek', {start: '2019-11-17',weekday: '1'});
            assert.equal(next_dt.getMonth(), 11);
            assert.equal(next_dt.getDate(), 2);
        })

    })

    describe('getDayFromTrashType',()=>{
        let client;
        before(()=>{
            client = new Client('Asia/Tokyo', new TextCreator('ja-JP'));
        });
        describe('weekday',()=>{
            const trashes = [
                {
                    type: 'burn',
                    schedules: [
                        {type:'weekday',value: '0'},
                        {type:'weekday',value: '6'},
                    ]
                }
            ];
            it('当日が日曜日',()=>{
                let stub = sinon.stub(client,'calculateLocalTime');
                stub.withArgs(0).returns(new Date('2019/03/17'));
                const result = client.getDayFromTrashType(trashes,'burn');
                console.log(result.burn);
                assert.equal(result.burn.list[0].getDate(),'17');
                assert.equal(result.burn.list[1].getDate(),'23');
                assert.equal(result.burn.recent.getDate(),'17');
                stub.restore();
            });
            it('当日が金曜日',()=>{
                let stub = sinon.stub(client,'calculateLocalTime');
                stub.withArgs(0).returns(new Date('2019/03/15'));
                const result = client.getDayFromTrashType(trashes,'burn');
                assert.equal(result.burn.list[0].getDate(),'17');
                assert.equal(result.burn.list[1].getDate(),'16');
                assert.equal(result.burn.recent.getDate(),'16');
                stub.restore();
            });
        });
        describe('month',()=>{
            let stub;
            let client;
            before(()=>{
                client = new Client('Asia/Tokyo', new TextCreator('ja-JP'));
                stub = sinon.stub(client,'calculateLocalTime');
                stub.withArgs(0).returns(new Date('2019/02/15'));
            });
            it('翌月1日設定/同月追加/同月追加後の翌月/同日',()=>{
                const trashes = [
                    {
                        type: 'burn',
                        schedules: [
                            {type: 'month',value: '1'},
                            {type: 'month',value: '17'},
                            {type: 'month',value: '31'},
                            {type: 'month',value: '15'}
                        ]
                    }
                ];
                const result = client.getDayFromTrashType(trashes,'burn');
                assert.equal(result.burn.list[0].getMonth()+1,'3');
                assert.equal(result.burn.list[1].getMonth()+1,'2');
                assert.equal(result.burn.list[2].getMonth()+1,'3');
                assert.equal(result.burn.list[3].getMonth()+1,'2');
                assert.equal(result.burn.recent.getDate(),'15');
            });
            after(()=>{
                stub.restore();
            });
        });
        describe('biweek',()=>{ 
            it('第n曜日が一致する日にちでの計算',()=>{
                let stub; 
                const client = new Client('Asia/Tokyo', new TextCreator('ja-JP'));
                try {
                    stub = sinon.stub(client, 'calculateLocalTime');
                    stub.withArgs(0).returns(new Date('2019/03/13'));
                    const trashes = [
                        {
                            type: 'burn',
                            schedules: [
                                { type: 'biweek', value: '3-2' }, //当日
                                { type: 'biweek', value: '3-3' }, //1週間後
                                { type: 'biweek', value: '4-2' }, //同じ週の後ろの曜日
                                { type: 'biweek', value: '4-3' }, //1週間後の後ろの曜日
                                { type: 'biweek', value: '2-3' }, //1週間後の前の曜日
                                { type: 'biweek', value: '1-1' }  //翌月
                            ]
                        }
                    ];
                    const result = client.getDayFromTrashType(trashes, 'burn');
                    assert.equal(result.burn.list[0].getDate(), 13);
                    assert.equal(result.burn.list[1].getDate(), 20);
                    assert.equal(result.burn.list[2].getDate(), 14);
                    assert.equal(result.burn.list[3].getDate(), 21);
                    assert.equal(result.burn.list[4].getDate(), 19);
                    assert.equal(`${result.burn.list[5].getMonth() + 1}-${result.burn.list[5].getDate()}`, '4-1');
                    assert.equal(result.burn.recent.getDate(), 13);
                } finally {
                    stub.restore();
                }
            });
            it('同じ週に第n曜日が一致しない後ろの曜日での計算',()=>{
                const client = new Client('Asia/Tokyo', new TextCreator('ja-JP'));
                const stub = sinon.stub(client, 'calculateLocalTime');
                stub.withArgs(0).returns(new Date('2019/03/13'));
                try {
                    const trashes = [
                        {
                            type: 'burn',
                            schedules: [
                                { type: 'biweek', value: '5-3' }, //同じ週で回数が多い曜日
                                { type: 'biweek', value: '5-4' }, //1週間後で回数が多い曜日
                                { type: 'biweek', value: '5-2' }  //回数が既に終わっている曜日
                            ]
                        }
                    ];
                    const result = client.getDayFromTrashType(trashes, 'burn');
                    assert.equal(result.burn.list[0].getDate(), 15);
                    assert.equal(result.burn.list[1].getDate(), 22);
                    assert.equal(`${result.burn.list[2].getMonth() + 1}-${result.burn.list[2].getDate()}`, '4-12');
                    assert.equal(result.burn.recent.getDate(), 15);
                } finally {
                    stub.restore();
                }
            });
            it('同じ週に第n曜日が一致しない前の曜日での計算',()=>{
                const client = new Client('Asia/Tokyo', new TextCreator('ja-JP'));
                const stub = sinon.stub(client, 'calculateLocalTime');
                stub.withArgs(0).returns(new Date('2019/03/15'));
                try {
                    const trashes = [
                        {
                            type: 'burn',
                            schedules: [
                                { type: 'biweek', value: '4-3' }, //1週間後で回数が少ない曜日
                            ]
                        }
                    ];
                    const result = client.getDayFromTrashType(trashes, 'burn');
                    assert.equal(result.burn.list[0].getDate(), 21);
                    assert.equal(result.burn.recent.getDate(), 21);
                } finally {
                    stub.restore();
                }
            });
        });
        describe('evweek',()=>{
            let stub;
            let client;
            before(()=>{
                client = new Client('Asia/Tokyo', new TextCreator('ja-JP'));
                stub = sinon.stub(client,'calculateLocalTime');
                stub.withArgs(0).returns(new Date('2019/03/15'));
            });
            it('今週/翌週/当日',()=>{
                const trashes = [
                    {
                        type: 'burn',
                        schedules: [
                            {type: 'evweek',value:{weekday: '6',start:'2019-02-24'}},
                            {type: 'evweek',value:{weekday: '6',start:'2019-03-03'}},
                            {type: 'evweek',value:{weekday: '5',start:'2019-03-10'}}
                        ]
                    }
                ];
                const result = client.getDayFromTrashType(trashes,'burn');
                assert.equal(result.burn.list[0].getDate(),'16');
                assert.equal(result.burn.list[1].getDate(),'23');
                assert.equal(result.burn.list[2].getDate(),'15');
                assert.equal(result.burn.recent.getDate(),'15');
            });
            after(()=>{
                stub.restore();
            });
        });
        describe('nomatch',()=>{
            it('該当するごみが登録されていない',()=>{
                const trashes = [
                    {
                        type: 'burn',
                        schedules: [{type: 'weekday',value:'0'}]
                    }
                ];
                const result = client.getDayFromTrashType(trashes,'unburn');
                assert.equal(result.burn,undefined);
            });
        });
        describe('other match',()=>{
            let stub;
            let client;
            before(()=>{
                client = new Client('Asia/Tokyo', new TextCreator('ja-JP'));
                stub = sinon.stub(client,'calculateLocalTime');
                stub.withArgs(0).returns(new Date('2019/03/15'));
            });
            it('複数のother登録',()=>{
                const trashes = [
                    { type: 'other', trash_val: '金属', schedules: [{type: 'weekday',value:'5'},{type: 'month',value:'30'}] },
                    { type: 'other', trash_val: 'リソース', schedules: [{type: 'weekday',value:'5'},{type: 'month',value:'30'}] }
                ];
                const result = client.getDayFromTrashType(trashes,'other');
                console.log(result);
                assert.equal(result['金属'].list.length,2);
                assert.equal(result['リソース'].list.length,2);
                assert.equal(result['金属'].list[0].getDate(),'15');
                assert.equal(result['リソース'].list[0].getDate(),'15');
                assert.equal(result['金属'].recent.getDate(),'15');
                assert.equal(result['リソース'].recent.getDate(),'15');
            });
            after(()=>{
                stub.restore();
            });
        });
    });
});

describe('getRemindBody',()=>{
    let client = null;
    before(()=>{
        client = new Client('Asia/Tokyo', new TextCreator('ja-JP'));
    });
    describe('thisweek', ()=>{
        it('sunday', async()=>{
            const stub = sinon.stub(Date.prototype, 'getTime');
            stub.withArgs().returns(1564892787630); //2019/8/4
            const result_list = await client.getRemindBody(0, testData.reminder);
            assert.equal(result_list.length, 6)
            assert.equal(result_list[2].body[0].type, 'burn')
            assert.equal(result_list[5].body[0].type, 'other')
            stub.restore();
        });
        it('saturday', async()=>{
            const stub = sinon.stub(Date.prototype, 'getTime');
            stub.withArgs().returns(1565362800000); //2019/8/10
            const result_list = await client.getRemindBody(0, testData.reminder);
            assert.equal(result_list.length, 0)
            stub.restore();
        })
    });
    describe('nextweek', ()=>{
        it('sunday', async()=>{
            const stub = sinon.stub(Date.prototype, 'getTime');
            stub.withArgs().returns(1564892787630); //2019/8/4
            const result_list = await client.getRemindBody(1, testData.reminder);
            assert.equal(result_list.length, 7)
            assert.equal(result_list[0].body[0].type, 'burn')
            assert.equal(result_list[0].body[1].type, 'can')
            assert.equal(result_list[3].body[0].type, 'burn')
            assert.equal(result_list[6].body.length, 0)
            stub.restore();
        });
        it('saturday',async()=>{
            const stub = sinon.stub(Date.prototype, 'getTime');
            stub.withArgs().returns(1565362800000); //2019/8/10
            const result_list = await client.getRemindBody(1, testData.reminder);
            assert.equal(result_list.length, 7)
            assert.equal(result_list[0].body[0].type, 'burn')
            assert.equal(result_list[0].body[1].type, 'can')
            assert.equal(result_list[3].body[0].type, 'burn')
            assert.equal(result_list[6].body.length, 0)
            stub.restore();
        })
    })
});

describe('getTrashData', function () {
    const aws = require("aws-sdk");
    const documentClient = new aws.DynamoDB.DocumentClient({region: "us-west-2"});
    const access_token_001 = "abcd989049AsdjfdALJD0j-sdfadshfF";
    const hash_001 = crypto.createHash("sha512").update(access_token_001).digest("hex");
    const id_001 = "10b38bbe-8a0f-4afc-afa9-c00aaac1d1de";

    const access_token_002 = "bbbbbbbbb";
    const hash_002 = crypto.createHash("sha512").update(access_token_002).digest("hex");
    
    // 旧型のアクセストークン
    const access_token_003 = "10b38bbe-8a0f-4afc-afa9-c00aaac1d1df";
    before((done)=>{
        documentClient.batchWrite({
            RequestItems: {
                "throwtrash-backend-accesstoken": [
                    {
                        PutRequest: {
                            Item: {
                                access_token:  hash_001,
                                expire_in: Math.ceil(Date.now()/1000) + 5 * 60,
                                user_id:  id_001
                            }
                        }
                    },
                    {
                        PutRequest: {
                            Item: {
                                access_token:  hash_002,
                                expire_in: Math.ceil(Date.now()/1000) + 5 * 60,
                                user_id:  "id002"
                            }
                        }
                    }
                ],
                "TrashSchedule": [
                    {
                        PutRequest: {
                            Item: {
                                id: id_001,
                                description: JSON.stringify(testData.evweek)
                            }
                        }
                    },
                    {
                        PutRequest: {
                            Item: {
                                id: access_token_003,
                                description: JSON.stringify(testData.evweek)
                            }
                        }
                    }
                ]
            }
        }).promise().then(()=>done())
    });
    it('正常データ', done=>{
        Client.getTrashData(access_token_001).then(result=>{
            assert.equal(result.status, 'success');
            done();
        });
    });
    it('正常データ（旧タイプ）', done=>{
        // 生アクセストークンが36桁の場合はそのままTrashScheduleを検索する
        Client.getTrashData(access_token_003).then(result=>{
            assert.equal(result.status, 'success');
            done();
        });
    });
    it('存在しないID', function (done) {
        Client.getTrashData(access_token_002).then(result => {
            assert.equal(result.status, 'error');
            assert.equal(result.msgId, 'id_not_found_error');
            done();
        });
    });
    it('存在しないアクセストークン', function (done) {
        Client.getTrashData('missing_access_token').then(result => {
            assert.equal(result.status, 'error');
            assert.equal(result.msgId, 'id_not_found_error');
            done();
        });
    });
    after((done)=>{
        documentClient.batchWrite({
            RequestItems: {
                "throwtrash-backend-accesstoken": [
                    {
                        DeleteRequest: {
                            Key: {
                                access_token: hash_001
                            }
                        }
                    },
                    {
                        DeleteRequest: {
                            Key: {
                                access_token: hash_002
                            }
                        }
                    }
                ],
                "TrashSchedule": [
                    {
                        DeleteRequest: {
                            Key: {
                                id: id_001
                            }
                        }
                    },
                    {
                        DeleteRequest: {
                            Key: {
                                id: access_token_003
                            }
                        }
                    }
                ]
            }
        }).promise().then(()=>done())
    })
});

describe('compareTwoText',()=>{
    it('正常データ',done=>{
        Client.compareTwoText('資源ごみ','資源ごみ').then(result=>{
            assert.equal(result.match,'資源ごみ')
            assert.ok(result.score>0)
            done();
        }).catch(err=>{
            assert.fail(err);
            done();
        });
    });
    it('異常データ', done=>{
        Client.compareTwoText('','ビン').then(()=>{
            assert.fail()
            done();
        }).catch(()=>{
            assert.ok(true);
            done();
        });
    });
});