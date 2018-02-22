import * as Http from "http";
import * as Https from "https";
import * as Express from "express";
import { Logger, getLogger } from "../logger";
import { SlackBotWrapper, SlackUserInfo } from "./serviceWorker";
import {SlackCallback, Config} from "../app";
import {uniqueId} from "../util";

let config: Config = {} as any;
try {
  config = require("../../settings.json");
}catch(e) {
  require("dotenv").config();
  config = {
    web: {
      port: Number(process.env.PORT || process.env.web_port || 7000),
      timeout: Number(process.env.web_timeout || 20000),
    },
    ssl: {
        key: process.env.ssl_key,
        cert: process.env.ssl_cert,
    },
    logger: {
        Console: {
            level: process.env.console_level || "info", 
            label: process.env.console_label || "Slackium",
            colorize: process.env.console_colorize || "all",
            prettyPrint: process.env.console_prettyPrint === "true",
            timestamp: process.env.console_timestamp === "true",
        },
        __File: {
            filename: process.env._file_filename || "Slackium.log",
            level: process.env._file_level || "info",
            label: process.env._file_label || "Slackium",
            json: process.env._file_json === "true",
        }
    }
  };
}

const logger: Logger = getLogger("SlackBot");
logger.info("webWorker: config: ", config);

interface Result {
    status: string;
    value?: any;
    cause?: string;
}

export interface Say {
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

// export interface SlackBots {
//     [id: string]: SlackBotWrapper,
// }

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

export type RequestActionType = 
    "create-service" 
    | "get-service" 
    | "delete-service"
    | "get-users"
    | "slack-say"
    | "start-hear"
    | "stop-hear"
    | "get-callback"
    | "post-callback"
;

export type ResponseContent = 
    string 
    | ServiceInfo 
    | ServiceInfo[]
    | { [name: string]: SlackUserInfo }
    | SlackCallback[]
;

export interface AtResponse { 
    result: boolean;
    body?: ResponseContent;
}

/**
 * 
 * @param action 
 * @param id 
 * @param option 
 */
function requestResponse(action: RequestActionType, id?: string, option?: any): Promise<AtResponse> {
    return new Promise<AtResponse>((resolve, reject)=>{
        let responseTimer = null;

        let responseHandler = (response: AtResponse) => {
            process.removeListener("message", responseHandler);
            responseTimer && clearTimeout(responseTimer);
            responseHandler = null;
            if(response.result) {
                resolve(response);
            }else {
                reject(response);
            }
        };
        process.on("message", responseHandler);

        responseTimer = setTimeout(()=>{
            process.removeListener("message", responseHandler);            
            responseHandler = null;
            reject("Reponse timeout");
        }, config.web.timeout);

        process.send({action, id, option});
    });
}

export class BotAPIServer {
    constructor(server: Https.Server|Http.Server, router: Express.Router) {

        router.post("/slack/service", (req, res) => {
            logger.info("POST /slack/service : ", req.body);

            const id: string = req.body.id || uniqueId();
            const option: SlackBotOption = req.body as SlackBotOption;
            requestResponse("create-service", id, option).then((response)=>{
                const id = response.body as string;
                res.status(200).send({result: true, id: id}).end();
            }).catch((error)=>{
                logger.error(`Error in processing request method=${req.method} path=${req.path}`, error);
                res.status(500).send({result: false}).end();
            });
        });

        router.get("/slack/service/:id", (req, res) => {
            logger.info("GET /slack/service/:id : ", req.params);

            const id = req.params.id;
            requestResponse("get-service", id).then((response)=>{
                const info = response.body as ServiceInfo;
                res.status(200).send({result: true, info: info}).end();
            }).catch((error)=>{
                logger.error(`Error in processing request method=${req.method} path=${req.path}`, error);
                res.status(500).send({result: false}).end();
            });
        });

        router.delete("/slack/service/:id", (req, res) => {
            logger.info("DELETE /slack/service/:id : ", req.params);

            const id = req.params.id;
            requestResponse("delete-service", id).then((response)=>{
                const id = response.body as string;
                res.status(200).send({result: true, id: id}).end();
            }).catch((error)=>{
                logger.error(`Error in processing request method=${req.method} path=${req.path}`, error);
                res.status(500).send({result: false}).end();
            });
        });

        router.get("/slack/:id/users", (req, res) => {
            logger.info("GET /slack/:id/users : ", req.body);

            const id = req.params.id;
            requestResponse("get-users", id).then((response)=>{
                const userInfo = response.body as { [name: string]: SlackUserInfo };
                res.status(200).send({result: true, info: userInfo}).end();
            }).catch((error)=>{
                logger.error(`Error in processing request method=${req.method} path=${req.path}`, error);
                res.status(500).send({result: false}).end();
            });
        });

        router.post("/slack/:id/say", (req, res) => {
            logger.info("POST /slack/:id/say : ", req.body);

            const id = req.params.id;
            const say: Say = req.body;
            requestResponse("slack-say", id, say).then((response)=>{
                res.status(200).send({result: true}).end();
            }).catch((error)=>{
                logger.error(`Error in processing request method=${req.method} path=${req.path}`, error);
                res.status(500).send({result: false}).end();
            });
        });

        router.post("/slack/:id/hear", (req, res) => {
            logger.info("POST /slack/:id/hear : ", req.body);

            const id = req.params.id;
            const hearRequest: HearResuest = {
                key: req.body.key,
                mention: req.body.mention && req.body.mention.split(","),
                cell: req.body.cell,
                path: req.body.path,
                username: req.body.username,
                password: req.body.password,
            }

            requestResponse("start-hear", id, hearRequest).then((response)=>{
                const hearId = response.body as string;
                res.status(200).send({result: true, hear_id: hearId}).end();
            }).catch((error)=>{
                logger.error(`Error in processing request method=${req.method} path=${req.path}`, error);
                res.status(500).send({result: false}).end();
            });
        });

        router.delete("/slack/:id/hear", (req, res) => {
            logger.info("DELETE /slack/:id/hear : ", req.body);

            const id = req.params.id;
            const hearId = req.body.hear_id;
            requestResponse("stop-hear", id, {hearId}).then((response)=>{
                const hearId = response.body as string;
                res.status(200).send({result: true, hear_id: hearId}).end();
            }).catch((error)=>{
                logger.error(`Error in processing request method=${req.method} path=${req.path}`, error);
                res.status(500).send({result: false}).end();
            });
        });

        router.get("/slack/:id/callback", (req, res) => {
            const payload: SlackCallback = req.body.parload;
            logger.info("GET /slack/:id/callback : ", payload);

            const id = req.params.id;
            requestResponse("get-callback", id).then((response)=>{
                const callbackInfoList = response.body as SlackCallback[];
                res.status(200).send({result: true, list: callbackInfoList}).end();
            }).catch((error)=>{
                logger.error(`Error in processing request method=${req.method} path=${req.path}`, error);
                res.status(500).send({result: false}).end();
            });
        });

        router.post("/slack/callback", (req, res) => {
            const payloadStr: string = req.body.payload;
            try {
                const payload: SlackCallback = JSON.parse(payloadStr);
                const serviceId = payload.callback_id;
                logger.info("POST /slack/callback : ", {serviceId, payload});

                requestResponse("post-callback", serviceId, payload).then((response)=>{
                    if(response.result) {
                        res.status(200).send("Processing now...").end();
                    }else {
                        res.status(500).send("I'm sorry, failed...").end();
                    }
                }).catch((error)=>{
                    logger.error(`Error in processing request method=${req.method} path=${req.path}`, error);
                    res.status(500).send("I'm sorry, failed...").end();
                });
            }catch(e) {
                logger.warn("/slack/callback: payload is not json.");
                res.status(500).send("I'm sorry, failed...").end();
            }
        });
    }

}
