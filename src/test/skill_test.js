'use strict'
const common = require("trash-common");
const logger = common.getLogger();
logger.LEVEL =  logger.DEBUG;

// デバッガログの出力設定
process.env.RUNLEVEL = 'DEBUG';
process.env.APP_REGION = "us-west-2"

const va = require('virtual-alexa');
const model = require('./model.json');
const handler = './index.js'; //テスト実行ディレクトリを基準とした相対パス
const jp_message = require('../common/template_text/ja-JP.text.json');
const alexa = va.VirtualAlexa.Builder()
                .handler(handler)
                .interactionModel(model)
                .create();
alexa.dynamoDB().mock();
const assert = require('assert');
const Client = require('../client.js');
const sinon = require('sinon');

describe('Launch',()=>{
    before(()=>{
        sinon.stub(Client.prototype,'calculateLocalTime').returns(new Date(1554298037605));//2019/4/3 Wed 13h
        sinon.stub(Client, 'getTrashData').withArgs('testdata').returns({
            status: 'sccess',
            response: [{"type": "bin", "schedules": [{ "type": "biweek", "value": "3-4" }, { "type": "weekday", "value": "4" }, { "type": "none", "value": "" } ] }, { "type": "can", "schedules": [ { "type": "weekday", "value": "3" }, { "type": "month", "value": "26" }, { "type": "none", "value": "" } ] }]
        });
    });
    it('Launch without accesstoken', async ()=>{
        const request = alexa.request().launch().set('request.locale', 'ja-JP')
        const response = await request.send();
        assert.equal(response.prompt(), `<speak>${jp_message.help.account}</speak>`);
    });
    it('Launch with accesstoken', async()=>{
        const request = alexa.request().launch()
                            .set('request.locale', 'ja-JP')
                            .set('session.user.accessToken','testdata')
        const response = await request.send();
        assert.equal(response.prompt(), `<speak>今日出せるゴミは、カン、です。他に知りたい日にち、あるいはゴミの種類を言ってください。</speak>`);
    });
    it('Launch via RegularAction', async()=>{
        const request = alexa.request().launch()
                            .set('request.locale', 'ja-JP')
                            .set('session.user.accessToken','testdata')
                            .set('request.metadata.referrer', 'amzn1.alexa-speechlet-client.SequencedSimpleIntentHandler');
        const response = await request.send();
        assert.equal(response.prompt(), `<speak>今日出せるゴミは、カン、です。</speak>`);
    })
    after(()=>{
        sinon.restore();
    })
});

describe('GetDayFromTrashes',()=>{
    before(()=>{
        sinon.stub(Client.prototype,'calculateLocalTime').withArgs(0).returns(new Date(1554298037605));//2019/4/3 Wed 13h
        const client_stub = sinon.stub(Client, 'getTrashData');
        client_stub.withArgs('testdata').returns({
            status: 'success',
            response: [{type: 'other', trash_val: '野菜ジュース', schedules:[{type: 'weekday', value: '2'}]}]
        });
        client_stub.withArgs('testdata2').returns({
             status: 'success',
            response: [{type: 'other', trash_val: '不燃ごみ',schedules:[{type: 'weekday', value: '2'}]}]
        });
        client_stub.withArgs('testdata3').returns({
             status: 'success',
            response: [
                {type: 'burn',schedules:[{type: 'weekday', value:'3'}]},
                {type: 'other', trash_val: '不燃ごみ',schedules:[{type: 'weekday', value: '2'}]},
                {type: 'other', trash_val: 'ビンとペットボトル',schedules:[{type: 'weekday', value: '4'}]},
            ]
        });
        client_stub.withArgs('testdata4').returns({
             status: 'success',
            response: [{type: 'burn', schedules:[{type: 'weekday', value: '2'}]}]
        });
    });
    it('一致：登録情報がotherで発話が標準スロット外',async()=>{
        let compare = sinon.stub(Client,'compareTwoText').returns({match: "野菜ジュース",score:1});
        const request = alexa.request().intent('GetDayFromTrashType')
                            .set('request.locale', 'ja-JP')
                            .set('session.user.accessToken','testdata')
                            .set('request.intent.slots.TrashTypeSlot',
                                    {
                                        resolutions: {resolutionsPerAuthority:[{status:{code: 'NO_MATCH'}}]},
                                        value: '野菜のジュース'
                                    }
                                );
        const response = await request.send();
        // レスポンスは一致した登録データのtrash_val
        assert.equal(response.prompt(), '<speak>次に野菜ジュースを出せるのは4月9日 火曜日です。</speak>');
        compare.restore();
    });
    it('不一致：登録情報がotherで発話もother（スコアが低い）',async()=>{
        const compare = sinon.stub(Client,'compareTwoText').returns({match: "燃えるゴミ",score:0.1});
        const request = alexa.request().intent('GetDayFromTrashType')
                            .set('request.locale', 'ja-JP')
                            .set('session.user.accessToken','testdata')
                            .set('request.intent.slots.TrashTypeSlot',
                                    {
                                        resolutions: {resolutionsPerAuthority:[{status:{code: 'NO_MATCH'}}]},
                                        value: 'データ上には存在しないゴミ'
                                    }
                                );
        const response = await request.send();
        // レスポンスは発話したゴミの名前
        assert.equal(response.prompt(), '<speak>データ上には存在しないゴミはごみ出し予定に登録されていません。</speak>');
        compare.restore();
    });
    it('一致：登録情報がotherで発話が標準スロット',async()=>{
        const compare = sinon.stub(Client,'compareTwoText').returns({match: "不燃ごみ",score:0.9});
        const request = alexa.request().intent('GetDayFromTrashType')
                            .set('request.locale', 'ja-JP')
                            .set('session.user.accessToken','testdata2')
                            .set('request.intent.slots.TrashTypeSlot',
                                    {
                                        resolutions: {resolutionsPerAuthority:[{status:{code: 'ER_SUCCESS_MATCH'},values:[{value: {id: 'unburn', name: '燃えないゴミ'}}]}]},
                                        value: '不燃ゴミ'
                                    }
                                );
        const response = await request.send();
        // レスポンスは登録データotherのtrash_val
        assert.equal(response.prompt(), '<speak>次に不燃ごみを出せるのは4月9日 火曜日です。</speak>');
        compare.restore();
    });
    it('不一致：登録情報がotherで発話がスロット外（スコアが低い）',async()=>{
        const compare = sinon.stub(Client,'compareTwoText').returns({match: "不燃ゴミ",score:0.1});
        const request = alexa.request().intent('GetDayFromTrashType')
                            .set('request.locale', 'ja-JP')
                            .set('session.user.accessToken','testdata2')
                            .set('request.intent.slots.TrashTypeSlot',
                                    {
                                        resolutions: {resolutionsPerAuthority:[{status:{code: 'ER_SUCCESS_MATCH'},values:[{value: {id: 'can', name: 'カン'}}]}]},
                                        value: '空き缶'
                                    }
                                );
        const response = await request.send();
        // レスポンスは発話したゴミの名前
        assert.equal(response.prompt(), '<speak>空き缶はごみ出し予定に登録されていません。</speak>');
        compare.restore();
    });
    it('一致：登録情報が複数のotherで発話が標準スロット外',async()=>{
        const compare = sinon.stub(Client,'compareTwoText');
        compare.withArgs("ペットボトル","不燃ごみ").returns({match: "不燃ごみ", score:0.1});
        compare.withArgs("ペットボトル","ビンとペットボトル").returns({match: "ペットボトル",score:0.8});
        const request = alexa.request().intent('GetDayFromTrashType')
                            .set('request.locale', 'ja-JP')
                            .set('session.user.accessToken','testdata3')
                            .set('request.intent.slots.TrashTypeSlot',
                                    {
                                        resolutions: {resolutionsPerAuthority:[{status:{code: 'NO_MATCH'}}]},
                                        value: 'ペットボトル'
                                    }
                                );
        const response = await request.send();
        // レスポンスは登録データで最も一致率が高かったデータのtrash_val
        assert.equal(response.prompt(), '<speak>次にビンとペットボトルを出せるのは4月4日 木曜日です。</speak>');
        compare.restore();
    });
    it('一致：微妙なスコア(0.5以上0.7未満）の場合',async()=>{
        const compare = sinon.stub(Client,'compareTwoText');
        compare.withArgs("ペットボトル","不燃ごみ").returns({match: "不燃ごみ", score:0.1});
        compare.withArgs("ペットボトル","ビンとペットボトル").returns({match: "ビン",score:0.5});
        const request = alexa.request().intent('GetDayFromTrashType')
                            .set('request.locale', 'ja-JP')
                            .set('session.user.accessToken','testdata3')
                            .set('request.intent.slots.TrashTypeSlot',
                                    {
                                        resolutions: {resolutionsPerAuthority:[{status:{code: 'NO_MATCH'}}]},
                                        value: 'ペットボトル'
                                    }
                                );
        const response = await request.send();
        // レスポンスは登録データで最も一致率が高かったデータのtrash_val
        assert.equal(response.prompt(), '<speak>ビン ですか？次にビンとペットボトルを出せるのは4月4日 木曜日です。</speak>');
        compare.restore();
    });
    it('一致：登録情報がother以外で発話が標準スロット',async()=>{
        const request = alexa.request().intent('GetDayFromTrashType')
                            .set('request.locale', 'ja-JP')
                            .set('session.user.accessToken','testdata4')
                            .set('request.intent.slots.TrashTypeSlot',
                                    {
                                        resolutions: {resolutionsPerAuthority:[{status:{code: 'ER_SUCCESS_MATCH'},values:[{value: {id: 'burn', name: '燃えるゴミ'}}]}]},
                                        value: '可燃ゴミ'
                                    }
                                );
        const response = await request.send();
        // レスポンスは登録データのtypeにもとづく標準名称
        assert.equal(response.prompt(), '<speak>次に燃えるゴミを出せるのは4月9日 火曜日です。</speak>');
    });
    it('一致：登録情報がother以外で発話がスロット外r',async()=>{
        const request = alexa.request().intent('GetDayFromTrashType')
                            .set('request.locale', 'ja-JP')
                            .set('session.user.accessToken','testdata4')
                            .set('request.intent.slots.TrashTypeSlot',
                                {
                                    resolutions: {resolutionsPerAuthority:[{status:{code: 'NO_MATCH'}}]},
                                    value: '燃えるゴミ'
                                }
                            );
        const response = await request.send();
        // レスポンスは登録情報なし
        assert.equal(response.prompt(), '<speak>燃えるゴミはごみ出し予定に登録されていません。</speak>');
    });
    it('一致：登録情報がotherで発話がother',async()=>{
        const request = alexa.request().intent('GetDayFromTrashType')
                            .set('request.locale', 'ja-JP')
                            .set('session.user.accessToken','testdata3')
                            .set('request.intent.slots.TrashTypeSlot',
                                {
                                    resolutions: {resolutionsPerAuthority:[{status:{code: 'ER_SUCCESS_MATCH'},values:[{value: {id: 'other', name: 'その他のゴミ'}}]}]},
                                    value: 'その他のゴミ'
                                }
                            );
        const response = await request.send();
        // レスポンスは登録情報なし
        assert.equal(response.prompt(), '<speak>次に不燃ごみを出せるのは4月9日 火曜日、ビンとペットボトルを出せるのは4月4日 木曜日です。</speak>');
    });

    it('APIエラー',async ()=>{
        const compare = sinon.stub(Client,'compareTwoText').returns(Promise.reject("err"));
        const request = alexa.request().intent('GetDayFromTrashType')
                            .set('request.locale', 'ja-JP')
                            .set('session.user.accessToken','testdata')
                            .set('request.intent.slots.TrashTypeSlot',
                                    {
                                        resolutions: {resolutionsPerAuthority:[{status:{code: 'NO_MATCH'}}]},
                                        value: '野菜ジュース'
                                    }
                                );
        process.env.MecabAPI_URL = '';
        const response = await request.send();
        assert.equal(response.prompt(), `<speak>${jp_message.error.unknown}</speak>`);
        compare.restore();
    })
    after(()=>{
        sinon.restore();
    })
    })