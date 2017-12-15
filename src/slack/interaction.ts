process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import * as Botkit from "botkit";
import * as moment from "moment";
import * as _ from "underscore";
import { PersoniumClient, PersoniumData, PersoniumAccessToken, PersoniumResponse } from "personium-client";
import { slackbot } from "botkit";

import { Logger, getLogger } from "../logger";
import { HearResuest, SlackBotOption } from "./bot-api";
import { uniqueId } from "../util";

export interface SlackUserInfo {
    id: string;
    team_id: string;
    name: string;
    deleted: boolean;
    color: string;
    real_name: string;
    tz: string;
    tz_label: string;
    tz_offset: number;
    profile: [Object];
    is_admin: boolean;
    is_owner: boolean;
    is_primary_owner: boolean;
    is_restricted: boolean;
    is_ultra_restricted: boolean;
    is_bot: boolean;
    updated: number;
    is_app_user: boolean;
}

export interface SlackCallback {
    __id: string;
    actions: [
        {
            name: string;
            value: string;
            type: string;
        }
    ],
    callback_id: string;
    team: {
        id: string;
        domain: string;
    },
    channel: {
        id: string;
        name: string;
    },
    user: {
        id: string;
        name: string;
    },
    action_ts: string;
    message_ts: string;
    attachment_id: string;
    token: string;
    original_message: {
        text: string;
        attachments: [
            {
                title: string;
                fields: [{
                    title: string;
                    value: string;
                    short: boolean;
                }],
                author_name: string;
                author_icon: string;
                image_url: string;
            }
        ]
    },
    response_url: string;
    trigger_id: string;
}

export interface SlackChannelInfo {
    id: string;
    name: string;
}

export interface HearingState {
    [id: string]: HearResuest,
}

const logger: Logger = getLogger("SlackBot");

export class SlackBotWrapper {
    id: string = null;
    host: string = null;
    slackToken: string = null;
    state: boolean = false;
    receiveCallbackCell: string = null;
    receiveCallbackUsername: string = null;
    receiveCallbackPassword: string = null;
    receiveCallbackPath: string = null;
    receiveCallbackPersoniumToken: PersoniumAccessToken = null;
    receiveCallbackClient: PersoniumClient = null;
    
    bot: Botkit.SlackBot = null;
    controller: Botkit.Controller<any, any, any> = null;
    slackChannelMapWithId: { [id: string]: SlackChannelInfo } = null;
    slackChannelMapWithName: { [name: string]: SlackChannelInfo } = null;
    slackUserListWithId: { [id: string]: SlackUserInfo } = null;
    slackUserListWithName: { [name: string]: SlackUserInfo } = null;
    callbackInfoList: SlackCallback[] = [];
    hearingState: HearingState = {};
    checkMapInterval: NodeJS.Timer = null;
    
    constructor(id: string, option: SlackBotOption) {
        this.id = id;
        this.host = option.host;
        this.slackToken = option.token;
        this.state = false;
        this.receiveCallbackCell = option.cell;
        this.receiveCallbackUsername = option.username;
        this.receiveCallbackPassword = option.password;
        this.receiveCallbackPath = option.path;

        this.receiveCallbackClient = new PersoniumClient(this.host);

        this.controller = Botkit.slackbot({
            debug: false,
        });
    }

    open(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.receiveCallbackClient.login(
                this.receiveCallbackCell, 
                this.receiveCallbackUsername, 
                this.receiveCallbackPassword, 
                (refreshToken: string)=>{
                    logger.info("token expired, so relogin");
                    this.receiveCallbackClient.refreshAccessToken(this.receiveCallbackCell, refreshToken);
            }).then((response) => {
                this.receiveCallbackPersoniumToken = response;
                return this.startSlack();
            }).then(()=>{
                this.state = true;
                resolve();
            }).catch((error)=>{
                reject(error);
            });

        });
    }

    /**
     * receive callback info from slack directly
     * @param callbackResult 
     */
    callback(callbackResult: SlackCallback) {
        logger.info("callback from slack: ", callbackResult.__id);
        this.callbackInfoList.push(callbackResult); // TODO サービスからも取得できるようにする
        this.receiveCallbackClient.post(this.receiveCallbackCell, this.receiveCallbackPath, {raw: JSON.stringify(callbackResult)})
        .then(()=>{
            logger.info("stored callback result: ", callbackResult.__id);
        }).catch((error)=>{
            logger.error("Error in receiving callback: ", error);
        });
    }

    close() {
        if(this.checkMapInterval) {
            clearInterval(this.checkMapInterval);
        }
    }

    /**
     * channel name -> channel Id
     * @param channelName 
     */
    getChannelId(channelName: string): string {
        let result = null;
        if (!channelName) {
            channelName = "general";
        }
        const slackChannelInfo = this.slackChannelMapWithName[channelName];
        if (slackChannelInfo) {
            result = slackChannelInfo.id;
        }
        return result;
    }

    getChannelName(channelId: string): string {
        let result = null;
        if(!channelId) {
            result = "general";
        }else {
            const slackChannelInfo = this.slackChannelMapWithId[channelId];
            if (slackChannelInfo) {
                result = slackChannelInfo.name;
            }
        }
        return result;
    }

    getUserName(userId: string): string {
        let result = null;
        const slackUserInfo = this.slackUserListWithId[userId];
        if (slackUserInfo) {
            result = slackUserInfo.name;
        }
        return result;
    }

    /**
     * create slack user infomation map
     */
    createSlackUserMap() {
        return new Promise<any>((resolve, reject) => {
            const createProcess = ()=>{
                return new Promise<void>((resolve, reject)=>{
                    this.slackUserListWithId = {};
                    this.slackUserListWithName = {};
                    this.bot.api.users.list({ token: this.slackToken }, (err, response) => {
                        if(err) {
                            logger.error("Error in createSlackUserMap: ", err);
                            resolve();
                        }else {
                            const openProcesses = response.members.map((user) => {
                                return new Promise<void>((_resolve, _reject)=>{
                                    this.slackUserListWithId[user.id] = user;
                                    this.slackUserListWithName[user.name] = user;
                                    if(!user.is_bot && !user.is_app_user) { 
                                        this.bot.api.im.open({user: user.id}, (err, res)=>{
                                            if(err) {
                                                logger.error("Error in bot.api.im.open: ", err);
                                                _resolve();
                                            }else {
                                                if(res && res.ok){
                                                    this.slackChannelMapWithId[res.channel.id] = {
                                                        id: user.id,
                                                        name: user.name,
                                                    };
                                                    this.slackChannelMapWithName[user.id] = {
                                                        id: res.channel.id,
                                                        name: user.name,
                                                    };
                                                }else {
                                                    logger.warn("Failed in bot.api.im.open: ", res);
                                                }
                                                _resolve();
                                            }
                                        });
                                    }else {
                                        _resolve();
                                    }
                                });
                            });
                            if(openProcesses.length > 0){
                                Promise.all(openProcesses).then(()=>{
                                    resolve();
                                }).catch((errors)=>{
                                    logger.error("Error in openProcesses:", errors);
                                    reject(errors);
                                });
                            }else {
                                resolve();
                            }
                        }
                    });
                });
            };

            if (!this.slackUserListWithId || !this.slackUserListWithName) {
                createProcess().then(()=>{
                    resolve();
                }).catch((error)=>{
                    reject(error);
                });
            } else {
                const closePromises = Object.keys(this.slackUserListWithId).map((id)=>{
                    return new Promise<void>((_resolve, _reject)=>{
                        if(this.slackChannelMapWithName[id]){
                            const channelId = this.slackChannelMapWithName[id].id;
                            if(channelId) {
                                this.bot.api.im.close({channel: channelId}, (err, res) => {
                                    if(err) {
                                        logger.error("Error in bot.api.im.close: ", err);
                                    }
                                    delete this.slackChannelMapWithName[id];
                                    _resolve();
                                });
                            }else {
                                _resolve();
                            }
                        }else {
                            _resolve();
                        }
                    });
                });
                return Promise.all(closePromises).then(()=>{
                    createProcess().then(()=>{
                        resolve();
                    }).catch((error)=>{
                        reject(error);
                    });
                }).catch((errors)=>{
                    reject(errors);
                });
            }
        });
    }

    createSlackChannelMap() {
        return new Promise<any>((resolve, reject) => {
            this.slackChannelMapWithId = {};
            this.slackChannelMapWithName = {};
            this.bot.api.channels.list({ token: this.slackToken }, (err, response) => {
                if(err) {
                    logger.error("Error in createSlackChannelMap: ", err);
                    resolve();
                }else {
                    response.channels.forEach((channel: SlackChannelInfo) => {
                        this.slackChannelMapWithId[channel.id] = channel;
                        this.slackChannelMapWithName[channel.name] = channel;
                    });
                    resolve();
                }
            });
        });
    }

    createMap() {
        return new Promise<void>((resolve, reject) => {
            this.createSlackChannelMap().then(() => {
                return this.createSlackUserMap();
            }).then(()=>{
                this.checkMapInterval = setInterval(()=>{
                    this.createSlackUserMap();
                    this.createSlackChannelMap();
                }, 1000 * 60 * 60); // TODO each an hour
                resolve();
            }).catch((error)=>{
                reject(error);
            });
        });
    }

    startSlack(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.bot = this.controller.spawn({
                token: this.slackToken,
            }).startRTM((err) => {
                if (err) {
                    logger.info("Failed to start RTM:", err);
                    return setTimeout(this.startSlack.bind(this), 60000);
                }

                this.controller.on("rtm_close", (bot, err) => {
                    logger.error("Error and slack close: ", err);
                    setTimeout(this.startSlack.bind(this), 60000);
                });

                this.createMap().then(() => {
                    // say hi
                    this.controller.hears("hi", ["direct_message", "direct_mention", "mention"], (bot: Botkit.SlackBot, message: Botkit.Message) => {
                        bot.reply(message, "hi");
                    });
                    resolve();
                }).catch((error) => { 
                    logger.error("Error in createMap/settingReply: ", error);
                    reject(error);
                });
            });
        });
    }

    /**
     * get user info
     */
    users() {
        return new Promise< { [name: string]: SlackUserInfo }>((resolve, reject)=>{
            resolve(this.slackUserListWithName);
        });
    }

    /**
     * bot says text in the specified channel
     * @param text 
     * @param channelName 
     */
    say(text: string, channelName: string, attachments?: Botkit.SlackAttachment[]) {
        return new Promise<void>((resolve, reject)=>{
            const channel = this.getChannelId(channelName);
            (this.bot as any).say({ text, channel, attachments });
            resolve();
        });
    }

    /**
     * 
     * @param req 
     */
    startHearing(req: HearResuest) {
        return new Promise<string>((resolve, reject)=>{
            const mention = req.mention || ["message_received", "ambient", "direct_message", "direct_mention", "mention"];
            const hearId = uniqueId();
            this.hearingState[hearId] = _.assign({}, req);
            this.controller.hears(req.key, mention, (bot: Botkit.SlackBot, message: Botkit.Message) => {
                if(this.hearingState[hearId]) {
                    const entity = {
                        action: message.action,
                        channel: this.getChannelName(message.channel),
                        text: message.text,
                        user: this.getUserName(message.user),
                    }
                    const client: PersoniumClient = new PersoniumClient(this.host);
                    client.login(req.cell, req.username, req.password).then(()=>{
                        return client.post(req.cell, req.path, entity);
                    }).then(()=>{
                        logger.info("receive and write a heard message.", entity);
                    }).catch((error)=>{
                        logger.error("Error in hear: ", error);
                    });
                }
            });
            resolve(hearId);
        });
    }

    stopHearing(hearId: string) {
        return new Promise<string>((resolve, reject)=>{
            if(this.hearingState[hearId]) {
                delete this.hearingState[hearId];
            }
            resolve();
        });
    }


}

