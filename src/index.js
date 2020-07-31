'use strict';
const common = require("trash-common");
const logger = common.getLogger();
logger.LEVEL = process.env.RUNLEVEL === "INFO" ? logger.INFO : logger.DEBUG;

const Alexa = require('ask-sdk');
const {S3PersistenceAdapter} = require('ask-sdk-s3-persistence-adapter');
const Client = require('./client.js');
const TextCreator = require('./common/text-creator');
const DisplayCreator = require('./common/display-creator');
let textCreator, displayCreator, client;
const PointDayValue = [
    {value:0},
    {value:1},
    {value:2},
    {value:3,weekday:0},
    {value:4,weekday:1},
    {value:5,weekday:2},
    {value:6,weekday:3},
    {value:7,weekday:4},
    {value:8,weekday:5},
    {value:9,weekday:6}
];

const persistenceAdapter = new S3PersistenceAdapter({bucketName: `throwtrash-skill-preference-${process.env.APP_REGION}`});

const init = async (handlerInput,option)=>{
    const { requestEnvelope, serviceClientFactory } = handlerInput;
    const locale = requestEnvelope.request.locale;
    textCreator = new TextCreator(locale);
    if(option.display) {
        displayCreator = new DisplayCreator(locale);
    }
    if(option.client) {
        const deviceId = requestEnvelope.context.System.device.deviceId;
        let upsServiceClient = null;
        try {
            upsServiceClient = serviceClientFactory.getUpsServiceClient();
        } catch(e) {
            logger.error(e)
        }
        // タイムゾーン取得後にclientインスタンスを生成
        return (deviceId && upsServiceClient ? 
            upsServiceClient.getSystemTimeZone(deviceId) : new Promise(resolve => { resolve('Asia/Tokyo') })
        ).then(timezone=>{
            logger.debug('timezone:'+timezone);
            return client = new Client(timezone, textCreator); 
        });
    } else {
        return;
    }
};

const getEntitledProducts = async(handlerInput)=>{
        const ms = handlerInput.serviceClientFactory.getMonetizationServiceClient();
        const locale = handlerInput.requestEnvelope.request.locale;
        const products =  await ms.getInSkillProducts(locale);
        return products.inSkillProducts.filter(record=> record.entitled === 'ENTITLED');
};

const updateUserHistory = async(handlerInput)=> {
    // 初回呼び出しおよびエラーが発生した場合には0除算を避けるため1を返す
    try {
        const attributes = await handlerInput.attributesManager.getPersistentAttributes();
        attributes.get_schedule_count = attributes.get_schedule_count ? attributes.get_schedule_count + 1 : 1;
        handlerInput.attributesManager.setPersistentAttributes(attributes);
        await handlerInput.attributesManager.savePersistentAttributes();
        return attributes.get_schedule_count;
    }catch(err){
        logger.error(err);
        return 1;
    }
};

const setUpSellMessage = async(handlerInput, responseBuilder) => {
    const user_count = await updateUserHistory(handlerInput);
    logger.debug(`UserCount: ${user_count}`);
    if (handlerInput.requestEnvelope.request.locale === 'ja-JP' && user_count % 5 === 0) {
        try {
            const entitledProducts = await getEntitledProducts(handlerInput);
            if (!entitledProducts || entitledProducts.length === 0) {
                logger.info("Upsell");
                responseBuilder.addDirective({
                    type: "Connections.SendRequest",
                    name: "Upsell",
                    payload: {
                        InSkillProduct: {
                            productId: process.env.REMINDER_PRODUCT_ID
                        },
                        upsellMessage: '<break stength="strong"/>' + textCreator.upsell
                    },
                    token: "correlationToken",
                });
                return true;
            }
        } catch(err) {
            logger.error(err);
        }
    }
    return false;
}

let skill;
exports.handler = async function(event,context) {
    if(!skill) {
        skill = Alexa.SkillBuilders.custom()
            .addRequestHandlers(
                LaunchRequestHandler,
                GetPointDayTrashesHandler,
                GetRegisteredContent,
                GetDayFromTrashTypeIntent,
                CheckReminderHandler,
                SetReminderHandler,
                PurchaseHandler,
                CancelPurchaseHandler,
                PurchaseResultHandler,
                HelpIntentHandler,
                CancelAndStopIntentHandler,
                SessionEndedRequestHandler,
                NextPreviousIntentHandler
            )
            .withSkillId(process.env.APP_ID)
            .withPersistenceAdapter(persistenceAdapter)
            .withApiClient(new Alexa.DefaultApiClient())
            .create();
    }
    return skill.invoke(event,context);
};

const LaunchRequestHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'LaunchRequest';
    },
    async handle(handlerInput){
        logger.debug(JSON.stringify(handlerInput));
        const {requestEnvelope, responseBuilder} = handlerInput;
        const init_ready = init(handlerInput, {client: true, display: true});
        const accessToken = requestEnvelope.session.user.accessToken;
        if(accessToken == null) {
            // トークン未定義の場合はユーザーに許可を促す
            return responseBuilder
                .speak(textCreator.require_account_link)
                .withLinkAccountCard()
                .getResponse();
        }
        const get_trash_ready = Client.getTrashData(accessToken);
        return Promise.all([init_ready, get_trash_ready]).then(async(results)=>{
            const data = results[1];
            if (data.status === 'error') {
                return responseBuilder
                    .speak(textCreator[data.msgId])
                    .withShouldEndSession(true)
                    .getResponse();
            }
            const promise_list = [
                client.checkEnableTrashes(data.response, 0),
                client.checkEnableTrashes(data.response, 1),
                client.checkEnableTrashes(data.response, 2)
            ];
            const all = await Promise.all(promise_list);
            const first = all[0];
            const second = all[1];
            const third = all[2] ;

            if (requestEnvelope.context.System.device.supportedInterfaces.Display) {
                const schedule_directive = displayCreator.getThrowTrashesDirective(0, [
                    { data: first, date: client.calculateLocalTime(0) },
                    { data: second, date: client.calculateLocalTime(1) },
                    { data: third, date: client.calculateLocalTime(2) },
                ])
                responseBuilder.addDirective(schedule_directive).withShouldEndSession(true);
            }
            responseBuilder.speak(textCreator.getLaunchResponse(first));

            const metadata = handlerInput.requestEnvelope.request.metadata;
            if(metadata && metadata.referrer === 'amzn1.alexa-speechlet-client.SequencedSimpleIntentHandler') {
                logger.debug("From Regular Action");
                responseBuilder.withShouldEndSession(true);
            } else if(!await setUpSellMessage(handlerInput, responseBuilder)) {
                logger.debug("Reprompt");
                const reprompt_message = textCreator.launch_reprompt;
                // アップセルを行わなければrepromptする
                responseBuilder.speak(textCreator.getLaunchResponse(first) + reprompt_message).reprompt(reprompt_message);
            }
            return responseBuilder.getResponse();
        });
    }
};

const GetPointDayTrashesHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest' &&
                handlerInput.requestEnvelope.request.intent.name === 'GetPointDayTrashes';
    },
    async handle(handlerInput){
        const {responseBuilder, requestEnvelope} = handlerInput;
        const init_ready = init(handlerInput, { client: true, display: true });
        const accessToken = requestEnvelope.session.user.accessToken;
        if(accessToken == null) {
            // トークン未定義の場合はユーザーに許可を促す
            return responseBuilder
                .speak(textCreator.require_account_link)
                .withLinkAccountCard()
                .getResponse();
        }
        const resolutions = requestEnvelope.request.intent.slots.DaySlot.resolutions;
        if(resolutions && resolutions.resolutionsPerAuthority[0].status.code === 'ER_SUCCESS_MATCH') {
            const slotValue =requestEnvelope.request.intent.slots.DaySlot.resolutions.resolutionsPerAuthority[0].values[0].value.id;

            const get_trash_ready = Client.getTrashData(accessToken);
            return Promise.all([init_ready, get_trash_ready]).then(async(results)=>{
                const trash_result = results[1];
                if (trash_result.status === 'error') {
                    return responseBuilder
                        .speak(textCreator[trash_result.msgId])
                        .withShouldEndSession(true)
                        .getResponse();
                }

                let target_day = 0;
                if (slotValue >= 0 && slotValue <= 2) {
                    target_day = PointDayValue[slotValue].value;
                } else {
                    target_day = client.getTargetDayByWeekday(PointDayValue[slotValue].weekday);
                }

                const promise_list = [
                    client.checkEnableTrashes(trash_result.response, target_day),
                    client.checkEnableTrashes(trash_result.response, target_day + 1),
                    client.checkEnableTrashes(trash_result.response, target_day + 2)
                ];
                const all = await Promise.all(promise_list);
                const first = all[0];
                const second = all[1];
                const third = all[2];
                responseBuilder.speak(textCreator.getPointdayResponse(slotValue, first));
                if (requestEnvelope.context.System.device.supportedInterfaces.Display) {
                    const schedule_directive = displayCreator.getThrowTrashesDirective(target_day, [
                        { data: first, date: client.calculateLocalTime(target_day) },
                        { data: second, date: client.calculateLocalTime(target_day + 1) },
                        { data: third, date: client.calculateLocalTime(target_day + 2) },
                    ]);
                    responseBuilder.addDirective(schedule_directive).withShouldEndSession(true);
                }
                
                await setUpSellMessage(handlerInput, responseBuilder);
                return responseBuilder.getResponse();
            });
        } else {
            const speechOut = textCreator.ask_point_day;
            return responseBuilder
                .speak(speechOut)
                .reprompt(speechOut)
                .getResponse();
        }
    }
};

const GetRegisteredContent = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest' &&
                handlerInput.requestEnvelope.request.intent.name === 'GetRegisteredContent';
    },
    async handle(handlerInput) {
        const {requestEnvelope, responseBuilder} = handlerInput;
        const init_ready = init(handlerInput, {client: true, display: true});
        const accessToken = requestEnvelope.session.user.accessToken;
        if(accessToken == null) {
            // トークン未定義の場合はユーザーに許可を促す
            return responseBuilder
                .speak(textCreator.require_account_link)
                .withLinkAccountCard()
                .getResponse();
        }

        const get_trash_ready = Client.getTrashData(accessToken);
        return Promise.all([init_ready, get_trash_ready]).then(results=>{
            const trash_result = results[1];
            if (trash_result.status === 'error') {
                return responseBuilder
                    .speak(textCreator[trash_result.msgId])
                    .withShouldEndSession(true)
                    .getResponse();
            }
            const schedule_data = textCreator.getAllSchedule(trash_result.response);
            if (requestEnvelope.context.System.device.supportedInterfaces.Display) {
                responseBuilder.addDirective(
                    displayCreator.getShowScheduleDirective(schedule_data)
                ).withShouldEndSession(true);
            }
            const card_text = textCreator.getRegisterdContentForCard(schedule_data);

            return responseBuilder.speak(textCreator.all_schedule).withSimpleCard(textCreator.registerd_card_title, card_text).getResponse();
        }).catch(()=>{
            return responseBuilder.speak(textCreator.general_error).withShouldEndSession(true).getResponse();
        });
    }
};
const GetDayFromTrashTypeIntent = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest' &&
                handlerInput.requestEnvelope.request.intent.name === 'GetDayFromTrashType';
    },
    async handle(handlerInput) {
        const {requestEnvelope, responseBuilder} = handlerInput;
        const init_ready = init(handlerInput, { client: true, display: false });
        const accessToken = requestEnvelope.session.user.accessToken;
        if(accessToken == null) {
            // トークン未定義の場合はユーザーに許可を促す
            return responseBuilder
                .speak(textCreator.require_account_link)
                .withLinkAccountCard()
                .getResponse();
        }
        const resolutions = requestEnvelope.request.intent.slots.TrashTypeSlot.resolutions;
        const get_trash_ready = Client.getTrashData(accessToken);
        const result = await  Promise.all([init_ready, get_trash_ready]);
        const trash_result = result[1];
        if (trash_result.status === 'error') {
            return responseBuilder
                .speak(textCreator[trash_result.msgId])
                .withShouldEndSession(true)
                .getResponse();
        }
        if(resolutions && resolutions.resolutionsPerAuthority[0].status.code === 'ER_SUCCESS_MATCH') {
            const slotValue = resolutions.resolutionsPerAuthority[0].values[0].value;
            const trash_data = client.getDayFromTrashType(trash_result.response, slotValue.id);
            if(Object.keys(trash_data).length > 0) {
                logger.debug('Find Match Trash:'+JSON.stringify(trash_data));
                responseBuilder
                    .speak(textCreator.getDayFromTrashTypeMessage(slotValue, trash_data))
                await setUpSellMessage(handlerInput, responseBuilder);
                return responseBuilder.getResponse();
            }
        } 
        // ユーザーの発話がスロット以外 または 合致するデータが登録情報に無かった場合はAPIでのテキスト比較を実施する
        logger.debug('Not match resolutions:'+JSON.stringify(requestEnvelope));

        // ユーザーが発話したゴミ
        const speeched_trash = requestEnvelope.request.intent.slots.TrashTypeSlot.value;
        logger.debug('check freetext trash:' + speeched_trash);
        // 登録タイプotherのみを比較対象とする
        const other_trashes = trash_result.response.filter((value)=>{
            return value.type === 'other'
        });

        let trash_data = [];

        // otherタイプの登録があれば比較する
        let speech_prefix = "";
        if(other_trashes.length > 0) {
            const compare_list = [];
            other_trashes.forEach(trash=>{
                compare_list.push(
                    Client.compareTwoText(speeched_trash,trash.trash_val)
                );
            });

            try {
                const compare_result = await Promise.all(compare_list);
                logger.info('compare result:'+JSON.stringify(compare_result));
                const max_data = {trash: "",score: 0, index: 0};
                compare_result.forEach((result,index)=>{
                    if(result.score >= max_data.score) {
                        max_data.trash = result.match
                        max_data.score = result.score
                        max_data.index = index
                    }
                });
                if(max_data.score >= 0.5) {
                    if(max_data.score < 0.7 && max_data.score >= 0.5) {
                        speech_prefix = `${max_data.trash} ですか？`;
                    }
                    trash_data = client.getDayFromTrashType([other_trashes[max_data.index]],'other');
                }
            } catch(error) {
                logger.error(error);
                return responseBuilder.speak(textCreator.unknown_error).withShouldEndSession(true).getResponse();
            }
        }
        responseBuilder.speak(speech_prefix + textCreator.getDayFromTrashTypeMessage({id: 'other', name: speeched_trash}, trash_data));

        await setUpSellMessage(handlerInput, responseBuilder);
        return responseBuilder.getResponse();
    }
};

const CheckReminderHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && handlerInput.requestEnvelope.request.intent.name === 'SetReminder'
            && (!handlerInput.requestEnvelope.request.intent.confirmationStatus
            || handlerInput.requestEnvelope.request.intent.confirmationStatus === 'NONE');
    },
    async handle(handlerInput) {
        logger.debug(`CheckReminderHandler -> ${JSON.stringify(handlerInput,null,2)}`)
        const {responseBuilder, requestEnvelope} = handlerInput;
        const consentToken = requestEnvelope.context.System.user.permissions
            && requestEnvelope.context.System.user.permissions.consentToken;
        if (!consentToken) {
            // リマインダーのパーミッションが許可されていない場合は許可を促す
            return responseBuilder
                .speak(textCreator.require_reminder_permission)
                .withAskForPermissionsConsentCard(['alexa::alerts:reminders:skill:readwrite'])
                .getResponse();
        }

        const accessToken = requestEnvelope.session.user.accessToken;
        if (!accessToken) {
            // トークン未定義の場合はユーザーにアカウントリンクを促す
            return responseBuilder
                .speak(textCreator.require_account_link)
                .withLinkAccountCard()
                .getResponse();
        }

        init(handlerInput, {client: false, display: false});
        return getEntitledProducts(handlerInput).then((entitledProducts)=>{
            if(entitledProducts && entitledProducts.length > 0) {
                const weekTypeSlot = requestEnvelope.request.intent.slots.WeekTypeSlot.resolutions;
                if(weekTypeSlot && weekTypeSlot.resolutionsPerAuthority[0].status.code === "ER_SUCCESS_NO_MATCH") {
                    logger.debug("WeekTypeSlot is not match")
                    return responseBuilder
                        .addElicitSlotDirective("WeekTypeSlot")
                        .speak(textCreator.ask_reminder_week)
                        .reprompt(textCreator.ask_reminder_week)
                        .getResponse();
                }
                const timerSlot = requestEnvelope.request.intent.slots.TimerSlot;
                const dialogState = requestEnvelope.request.dialogState;
                if (dialogState != 'COMPLETED') {
                    return responseBuilder
                        .addDelegateDirective()
                        .getResponse();
                } else {
                    return responseBuilder
                        .speak(textCreator.getReminderConfirm(weekTypeSlot.resolutionsPerAuthority[0].values[0].value.name, timerSlot.value))
                        .addConfirmIntentDirective()
                        .getResponse();
                }
            } else {
                // オプションが購入されていない場合は購入フローへ移る
                return responseBuilder.addDirective({
                    type: "Connections.SendRequest",
                    name: "Buy",
                    payload: {
                        InSkillProduct: {
                            productId: process.env.REMINDER_PRODUCT_ID
                        }
                    },
                    token: "correlationToken"
                }).getResponse();
            }
        });
    }
}

const SetReminderHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest' 
            && handlerInput.requestEnvelope.request.intent.name === 'SetReminder'
            && handlerInput.requestEnvelope.request.intent.confirmationStatus
            && handlerInput.requestEnvelope.request.intent.confirmationStatus != 'NONE';
    },
    handle(handlerInput) {
        const {responseBuilder, requestEnvelope, serviceClientFactory} = handlerInput;
        const init_ready = init(handlerInput, { client: true });
        const accessToken = requestEnvelope.session.user.accessToken;
        const get_trash_ready = Client.getTrashData(accessToken);
        if(requestEnvelope.request.intent.confirmationStatus === 'CONFIRMED') {
            return Promise.all([init_ready, get_trash_ready]).then(async(results) => {
                if (results[1].status === 'error') {
                    return responseBuilder
                        .speak(textCreator[results[1].msgId])
                        .withShouldEndSession(true)
                        .getResponse();
                }
                const weekTypeSlot = requestEnvelope.request.intent.slots.WeekTypeSlot.resolutions.resolutionsPerAuthority[0].values[0].value;
                const time = requestEnvelope.request.intent.slots.TimerSlot.value;
                const remind_data = await client.getRemindBody(Number(weekTypeSlot.id), results[1].response);
                const remind_requests = createRemindRequest(remind_data, time, textCreator.locale);

                const ReminderManagementServiceClient = serviceClientFactory.getReminderManagementServiceClient();
                const remind_list = []
                remind_requests.forEach((request_body) => {
                    remind_list.push(
                        ReminderManagementServiceClient.createReminder(request_body).then(data => {
                            logger.info('CreateReminder:');
                            logger.info(data);
                        })
                    );
                });
                return Promise.all(remind_list).then(() => {
                    return responseBuilder
                        .speak(textCreator.getReminderComplete(weekTypeSlot.name, time))
                        .withShouldEndSession(true)
                        .getResponse();
                }).catch((err)=>{
                    logger.error(err);
                    // ReminderManagementServiceClientでは権限が許可されていない場合401エラーが返る
                    if(err.statusCode === 401 || err.statuScode === 403) {
                        return responseBuilder
                            .speak(textCreator.require_reminder_permission)
                            .withAskForPermissionsConsentCard(['alexa::alerts:reminders:skill:readwrite'])
                            .getResponse();
                    }
                    return responseBuilder
                        .speak(textCreator.unknown_error)
                        .withShouldEndSession(true)
                        .getResponse();
                });
            });
        } else if(requestEnvelope.request.intent.confirmationStatus === 'DENIED') {
            return responseBuilder
                .speak(textCreator.reminder_cancel)
                .withShouldEndSession(true)
                .getResponse();
        }

    }
}

const PurchaseHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type ==='IntentRequest' &&
             handlerInput.requestEnvelope.request.intent.name === 'Purchase';
    },
    handle(handlerInput) {
        const {responseBuilder, requestEnvelope, serviceClientFactory} = handlerInput;
        const ms = serviceClientFactory.getMonetizationServiceClient();
        init(handlerInput, {});
        const locale = requestEnvelope.request.locale;
        return ms.getInSkillProducts(locale).then((result)=>{
            const entitledProducts = result.inSkillProducts.filter(record=> record.entitled === 'ENTITLED');
            if(entitledProducts && entitledProducts.length > 0) {
                return responseBuilder.speak(textCreator.already).reprompt(textCreator.reprompt).getResponse();
            } else {
                // オプションが購入されていない場合は購入フローへ移る
                return responseBuilder.addDirective({
                    type: "Connections.SendRequest",
                    name: "Buy",
                    payload: {
                        InSkillProduct: {
                            productId: process.env.REMINDER_PRODUCT_ID
                        }
                    },
                    token: "correlationToken"
                }).getResponse();
            }
        });
    }
};

const CancelPurchaseHandler = {
    canHandle(handlerInput){
        return handlerInput.requestEnvelope.request.type ==='IntentRequest'
                && handlerInput.requestEnvelope.request.intent.name === 'CancelPurchase'
    },
    handle(handlerInput) {
        init(handlerInput, {});
        return handlerInput.responseBuilder
            .addDirective({
                type: 'Connections.SendRequest',
                name: 'Cancel',
                payload: {
                    InSkillProduct: {
                        productId: process.env.REMINDER_PRODUCT_ID
                    }
                },
                token: "correlationToken"
            })
            .getResponse();
    }
}

const PurchaseResultHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type ==='Connections.Response';
    },
    handle(handlerInput) {
        init(handlerInput, {});
        const {requestEnvelope, responseBuilder} = handlerInput;
        const purchaseRequest = requestEnvelope.request;
        const purchasePayload = purchaseRequest.payload;
        logger.debug("PurchaseResult:" + JSON.stringify(purchasePayload));
        if(purchasePayload.purchaseResult === 'ACCEPTED') {
            if(purchaseRequest.name === 'Buy' ||  purchaseRequest.name === 'Upsell') {
                return responseBuilder
                    .speak(textCreator.thanks)
                    .reprompt(textCreator.reprompt)
                    .getResponse();
            } else {
                return responseBuilder
                    .speak(textCreator.cancel)
                    .withShouldEndSession(true)
                    .getResponse();
            }
        } else if(purchasePayload.purchaseResult === 'DECLINED') {
            return responseBuilder
                .speak(textCreator.cancel)
                .withShouldEndSession(true)
                .getResponse();
        } else if(purchasePayload.purchaseResult === 'ERROR') {
            return responseBuilder
                .speak(textCreator.cancel)
                .withShouldEndSession(true)
                .getResponse();
        } else if(purchasePayload.purchasePayload === 'ALREADY_PURCHASED') {
            return responseBuilder
                .speak(textCreator.thanks)
                .reprompt(textCreator.reprompt)
                .getResponse();
        }
    }
}

const HelpIntentHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest' &&
             handlerInput.requestEnvelope.request.intent.name === 'AMAZON.HelpIntent';
    },
    async handle(handlerInput) {
        init(handlerInput, {});
        const speechOutput = textCreator.help;
        return handlerInput.responseBuilder
            .speak(speechOutput)
            .reprompt(speechOutput)
            .getResponse();

    }
};

const CancelAndStopIntentHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest' &&
                (handlerInput.requestEnvelope.request.intent.name === 'AMAZON.CancelIntent' ||
                handlerInput.requestEnvelope.request.intent.name === 'AMAZON.StopIntent');
    },
    async handle(handlerInput) {
        init(handlerInput, {});
        const speechOutput = textCreator.goodbye;
        return handlerInput.responseBuilder.speak(speechOutput).withShouldEndSession(true).getResponse();

    }
};

const SessionEndedRequestHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'SessionEndedRequest';
    },
    async handle(handlerInput) {
        return handlerInput.responseBuilder
            .withShouldEndSession(true)
            .getResponse();
    }
};

const NextPreviousIntentHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest'
        && (handlerInput.requestEnvelope.request.intent.name === 'AMAZON.NextIntent'
        || handlerInput.requestEnvelope.request.intent.name === 'AMAZON.PreviousIntent');
    },
    async handle(handlerInput) {
        init(handlerInput, {});
        return handlerInput.responseBuilder
            .speak(textCreator.next_previous)
            .reprompt()
            .getResponse();
    }
};

const createRemindRequest = (remind_body, timer, locale) =>{
    const remind_requests = [];
    remind_body.forEach((body) => {
        const message = textCreator.getLaunchResponse(body.body);
        const scheduled_time = client.calculateLocalTime(body.target_day);
        const month = scheduled_time.getMonth() + 1 < 9 ? `0${scheduled_time.getMonth() + 1}` : scheduled_time.getMonth() + 1;
        const date = scheduled_time.getDate() < 10 ? `0${scheduled_time.getDate()}` : scheduled_time.getDate();
        remind_requests.push({
            "requestTime": new Date().toISOString(),
            "trigger": {
                "type": "SCHEDULED_ABSOLUTE",
                "scheduledTime": `${scheduled_time.getFullYear()}-${month}-${date}T${timer}:00.000`,
            },
            "alertInfo": {
                "spokenInfo": {
                    "content": [{
                        "locale": locale,
                        "text": message
                    }]
                }
            },
            "pushNotification": {
                "status": "ENABLED"
            }
        });
    });
    return remind_requests;
};
