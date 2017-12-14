import * as Http from "http";
import * as Express from "express";
import { Logger, getLogger } from "../logger";
import { SlackBotWrapper, SlackUserInfo } from "./interaction";
import {uniqueId} from "../util";

interface Result {
    status: string;
    value?: any;
    cause?: string;
}

interface Say {
    channel: string;
    message: string;
    attachments: string;
}

export interface HearResuest {
    key: string;
    mention: string[];
    cell: string;
    path: string;
    username: string;
    password: string;
}

export interface SlackBots {
    [id: string]: SlackBotWrapper,
}

export interface ServiceInfo {
    id: string,
    state: boolean,
}

export interface SlackBotOption {
    host: string;
    token: string;
    cell: string;
    username: string;
    password: string;
    path: string;
}

const logger: Logger = getLogger("SlackBot");

export class BotAPIServer {
    services: SlackBots = {};

    constructor(server: Http.Server, router: Express.Router) {

        router.post("/slack/service", (req, res) => {
            logger.info("POST /slack/service : ", req.body);

            const id: string = req.body.id || uniqueId();
            const option: SlackBotOption = req.body as SlackBotOption;
            this.createService(id, option).then((_id)=>{
                res.status(200).send({result: true, id: _id}).end();
            }).catch((error)=>{
                logger.error(`Error in processing request method=${req.method} path=${req.path}`, error);
                res.status(500).send({result: false}).end();
            });
        });

        router.get("/slack/service/:id", (req, res) => {
            logger.info("GET /slack/service/:id : ", req.params);

            const id = req.params.id;
            this.getService(id).then((info: ServiceInfo)=>{
                res.status(200).send({result: true, info: info}).end();
            }).catch((error)=>{
                logger.error(`Error in processing request method=${req.method} path=${req.path}`, error);
                res.status(500).send({result: false}).end();
            });
        });

        router.delete("/slack/service/:id", (req, res) => {
            logger.info("DELETE /slack/service/:id : ", req.params);

            const id = req.params.id;
            this.deleteService(id).then(()=>{
                res.status(200).send({result: true, id: id}).end();
            }).catch((error)=>{
                logger.error(`Error in processing request method=${req.method} path=${req.path}`, error);
                res.status(500).send({result: false}).end();
            });
        });

        router.get("/slack/:id/users", (req, res) => {
            logger.info("GET /slack/:id/users : ", req.body);

            const id = req.params.id;
            const slack = this.dispatchService(id);
            if(slack) {
                slack.users().then((userInfo:  { [name: string]: SlackUserInfo })=>{
                    res.status(200).send({result: true, info: userInfo}).end();
                }).catch((error)=>{
                    logger.error(`Error in processing request method=${req.method} path=${req.path}`, error);
                    res.status(500).send({result: false}).end();
                });
            }else {
                const error = `service is not instanciation, you call a 'create' method?`;
                logger.error(`Error in processing request method=${req.method} path=${req.path}`, error);
                res.status(500).send({result: false, error: error}).end();
            }
        });

        router.post("/slack/:id/say", (req, res) => {
            logger.info("POST /slack/:id/say : ", req.body);

            const id = req.params.id;
            const slack = this.dispatchService(id);

            if(slack) {
                const say: Say = req.body;
                let attachments = null;
                if(say.attachments) {
                    attachments = JSON.parse(say.attachments);
                }
                slack.say(say.message, say.channel, attachments).then(()=>{
                    res.status(200).send({result: true}).end();
                }).catch((error)=>{
                    logger.error(`Error in processing request method=${req.method} path=${req.path}`, error);
                    res.status(500).send({result: false}).end();
                });
            }else {
                const error = `service is not instanciation, you call a 'create' method?`;
                logger.error(`Error in processing request method=${req.method} path=${req.path}`, error);
                res.status(500).send({result: false, error: error}).end();
            }        
        });

        router.post("/slack/:id/hear", (req, res) => {
            logger.info("POST /slack/:id/hear : ", req.body);

            const id = req.params.id;
            const slack = this.dispatchService(id);

            if(slack) {
                const hearRequest: HearResuest = {
                    key: req.body.key,
                    mention: req.body.mention && req.body.mention.split(","),
                    cell: req.body.cell,
                    path: req.body.path,
                    username: req.body.username,
                    password: req.body.password,
                }
                slack.startHearing(hearRequest).then((hearId)=>{
                    res.status(200).send({result: true, hear_id: hearId}).end();
                }).catch((error)=>{
                    logger.error(`Error in processing request method=${req.method} path=${req.path}`, error);
                    res.status(500).send({result: false}).end();
                });
            }else {
                const error = `service is not instanciation, you call a 'create' method?`;
                logger.error(`Error in processing request method=${req.method} path=${req.path}`, error);
                res.status(500).send({result: false, error: error}).end();
            }        
        });

        router.delete("/slack/:id/hear", (req, res) => {
            logger.info("DELETE /slack/:id/hear : ", req.body);

            const id = req.params.id;
            const slack = this.dispatchService(id);

            if(slack) {
                const hearId = req.body.hear_id;
                slack.stopHearing(hearId).then(()=>{
                    res.status(200).send({result: true}).end();
                }).catch((error)=>{
                    logger.error(`Error in processing request method=${req.method} path=${req.path}`, error);
                    res.status(500).send({result: false}).end();
                });
            }else {
                const error = `service is not instanciation, you call a 'create' method?`;
                logger.error(`Error in processing request method=${req.method} path=${req.path}`, error);
                res.status(500).send({result: false, error: error}).end();
            }        
        });

    }

    dispatchService(id: string): SlackBotWrapper {
        const service: SlackBotWrapper = this.services[id];
        return service;
    }
    
    createService(id: string, option: SlackBotOption) {
        return new Promise<string>((resolve, reject)=>{
            let service: SlackBotWrapper = this.services[id];
            if(!service) {
                service = new SlackBotWrapper(id, option);
                this.services[id] = service;
                service.open().then(()=>{
                    logger.info("created service: "+ id);
                }).catch((error)=>{
                    logger.error("Error in createService: ", error);
                });
                resolve(id);
            }else {
                resolve();
            }
        });
    }
    
    getService(id?: string): Promise<ServiceInfo|ServiceInfo[]> {
        return new Promise<ServiceInfo|ServiceInfo[]>((resolve, reject)=>{
            if(id){
                const service = this.services[id];
                if(service){
                    const info: ServiceInfo = {
                        id: service.id,
                        state: service.state,
                    };
                    resolve(info);
                }else {
                    resolve();
                }
            }else {
                const results: ServiceInfo[] = Object.keys(this.services).map((id)=>{
                    const service = this.services[id];
                    return {
                        id: service.id,
                        state: service.state,
                    };
                });
                resolve(results);
            }
        });
    }
    
    deleteService(id: string): Promise<void> {
        return new Promise<void>((resolve, reject)=>{
            if(this.services[id]){
                delete this.services[id];
            }
            resolve();
        });
    }

    dispose() {
        Object.keys(this.services).forEach((id)=>{
            this.services[id].close();
        });
    }
}
