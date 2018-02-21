import * as winston from "winston";
import {doNothing, stringify} from "./util";
import {Config} from "./app";

let config: Config = {} as any;
try {
  config = require("../settings.json");
}catch(e) {
  require("dotenv").config();
  config = {
    web: {
      port: Number(process.env.web_port),
      timeout: Number(process.env.web_timeout),
    },
    ssl: {
        key: process.env.ssl_key,
        cert: process.env.ssl_cert,
    },
    logger: {
        Console: {
            level: process.env.console_level, 
            label: process.env.console_label,
            colorize: process.env.console_colorize,
            prettyPrint: process.env.console_prettyPrint === "true",
            timestamp: process.env.console_timestamp === "true",
        },
        __File: {
            filename: process.env._file_filename,
            level: process.env._file_level,
            label: process.env._file_lanel,
            json: process.env._file_json === "true",
        }
    }
  };
}

export type LogAction = (message: string, detail?: any)=>void;
export type LogLevel = "error" | "warn" | "info" | "debug";
export interface Logger {
    debug: LogAction;
    info: LogAction;
    warn: LogAction;
    error: LogAction;
}

export interface LogIpcMessageDetail{
    type: "text" | "json";
    data: any;
}

export interface LogIpcMessage{
    level: LogLevel;
    message: string;
    detail?: LogIpcMessageDetail;
    label?: string;
}

let logger: winston.LoggerInstance = null;
function getWinstonLoggerInstance(){
    if(logger){
        return logger;
    }else{
        logger = new winston.Logger();
        const transports: any[] = [];
        if(config.logger.Console){
            transports.push(new (winston.transports.Console)(config.logger.Console));
        }
        if(config.logger.__File){
            transports.push(new (winston.transports.File)(config.logger.__File));
        }
        logger.configure({ transports: transports });
        return logger;
    }
}

function createDetail(data: any): LogIpcMessageDetail{
    try{
        if(typeof data === "undefined" || data === null){
            return null;
        }else if(data instanceof Error){
            const text = JSON.stringify({message: String(data), stack: data.stack});
            return {
                type: "json",
                data: text
            }
        }else{
            const text = JSON.stringify(data);
            return {
                type: "json",
                data: text
            }
        }
    }catch(error){
        // 無理やり文字列にするのでnullは"null"になる
        const text = stringify(data);
        if(text === "null" || !text){
            return null;
        }else{
            return {
                type: "text",
                data: text
            }
        }
    }
}

export function convertLogIpcDetail(detail: LogIpcMessageDetail): any{
    if(detail){
        if(detail.type === "json"){
            try{
                const json = JSON.parse(detail.data);
                return json;
            }catch(error){
                return detail.data;
            }
        }else if(detail.type === "text"){
            return detail.data;
        }else{
            return null;
        }
    }else{
        return null;
    }
}

function craeteConsoleLogger(){
    return {
        debug: console.log,
        info: console.info,
        warn: console.warn,
        error: console.error
    };
}


class LoggerForMaster implements Logger {
    private logger: winston.LoggerInstance;
    private label: string;

    constructor(label: string = null) {
        this.label = label;
        console.log("config", config);
        if(typeof config.logger !== "undefined" && config.logger){
            if(config.logger.Console || config.logger.__File){
                this.logger = getWinstonLoggerInstance();
            }else{
                this.logger = craeteConsoleLogger() as any;
            }
        }else{
            this.logger = craeteConsoleLogger() as any;
        }
    }

    private createLogText(message: string): string{
        if(this.label){
            return `[${this.label}] ${message}`;
        }else{
            return message;
        }
    }

    public log(logLevel: LogLevel, message: string, detail?: any): void {
        const text = this.createLogText(message);
        if(logLevel === "error"){
            if(detail){
                this.logger.error(text, detail);
            }else{
                this.logger.error(text);
            }
        }else if(logLevel === "warn"){
            if(detail){
                this.logger.warn(text, detail);
            }else{
                this.logger.warn(text);
            }
        }else if(logLevel === "info"){
            if(detail){
                this.logger.info(text, detail);
            }else{
                this.logger.info(text);
            }
        }else if(logLevel === "debug"){
            if(detail){
                this.logger.debug(text, detail);
            }else{
                this.logger.debug(text);
            }
        }
    }

    error(message: string, detail?: any): void {
        this.log("error", message, detail);
    };

    warn(message: string, detail?: any): void {
        this.log("warn", message, detail);
    };

    info(message: string, detail?: any): void {
        this.log("info", message, detail);
    };

    debug(message: string, detail?: any): void {
        this.log("debug", message, detail);
    };
}

class LoggerForWorker implements Logger{
    private label: string;

    constructor(label: string = null){
        this.label = label;
    }

    log(level: LogLevel, message: string, detail?: any): void{
        const data:LogIpcMessage = {
            level: level,
            message: message,
            detail: createDetail(detail),
            label: this.label,
        }

        process.send({type: "log", data: data});
    }

    debug(message: string, detail?: any): void{
        this.log("debug", message, detail);
    }

    info(message: string, detail?: any): void{
        this.log("info", message, detail);
    }

    warn(message: string, detail?: any): void{
        this.log("warn", message, detail);
    }

    error(message: string, detail?: any): void{
        this.log("error", message, detail);
    }
}


export function getLogger(label: string): Logger {
    const logger: Logger = new LoggerForMaster(label);
    return logger;
}
