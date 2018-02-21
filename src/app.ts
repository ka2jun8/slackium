import cluster = require("cluster");
import { Logger, getLogger } from "./logger";
import { ExpressServer } from "./express";
import { SlackBotOption, ServiceInfo, RequestActionType, AtResponse, Say, HearResuest } from "./slack/webWorker";
import { slackbot } from "botkit";
import { setTimeout } from "timers";

export interface Config {
  web: {
    port: number,
    timeout: number,
  },
  ssl?: {
      key: string,
      cert: string,
  },
  logger: {
      Console: {
          level: string, 
          label: string,
          colorize: string,
          prettyPrint: boolean,
          timestamp: boolean,
      },
      __File: {
          filename: string,
          level: string,
          label: string,
          json: boolean,
      }
  }
}

let config: Config = {} as any;
try {
  config = require("../settings.json");
}catch(e) {
  require("dotenv").config();
  config = {
    web: {
      port: Number(process.env.PORT || process.env.web_port),
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
            label: process.env._file_label,
            json: process.env._file_json === "true",
        }
    }
  };
}

const logger = getLogger("Slackium");
logger.info("set: config: ", config);

const responseTimeout = config.web.timeout;

export interface WorkerRequest {
  action: RequestActionType,
  id: string,
  option: any;
}
export interface SlackBotWorkerMap {
  [id: string]: cluster.Worker;
}
export type ServiceWorkerAction =
 "service-open" | 
 "get-service" | 
 "get-users" | 
 "slack-say" | 
 "start-hear" | 
 "stop-hear" |
 "get-callback" |
 "post-callback"
 ;

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

export type ServiceWorkerOption = SlackBotOption | Say | HearResuest | SlackCallback;
export type ServiceResponseBody = ServiceInfo;

export interface ServiceResponse {
  result: boolean;
  body?: ServiceResponseBody;
}

const services: SlackBotWorkerMap = {};

/**
 * Interact Service Worker
 * @param serviceWorker 
 * @param action 
 * @param id 
 * @param option 
 */
function handleServiceMethod(serviceWorker: cluster.Worker, action: ServiceWorkerAction, id?: string, option?: any): Promise<ServiceResponse> {
  return new Promise<ServiceResponse>((resolve, reject) => {
    let responseTimer = null;

    let responseHandler = (response: ServiceResponse) => {
      serviceWorker.removeListener("message", responseHandler);
      responseTimer && clearTimeout(responseTimer);
      responseHandler = null;
      if (response.result) {
        resolve(response);
      } else {
        reject(response);
      }
    };
    serviceWorker.on("message", responseHandler);

    responseTimer = setTimeout(() => {
      serviceWorker.removeListener("message", responseHandler);
      responseHandler = null;
      reject("Reponse timeout");
    }, responseTimeout);

    serviceWorker.send({ action, id, option });
  });
};

function createService(id: string, option: SlackBotOption) {
  return new Promise<string>((resolve, reject) => {

    let service: cluster.Worker = services[id];
    if (!service) {
      service = cluster.fork({ service_process: true });
      logger.info("[Master] Service worker starts. ", {id: service.id, pid: service.process.pid});
      services[id] = service;

      const action: ServiceWorkerAction = "service-open";
      const setOption: ServiceWorkerOption = option;
      setTimeout(() => {
        handleServiceMethod(service, action, id, setOption).then((response) => {
          // resolve(id);
        }).catch((error) => {
          logger.error("Error in createService handleServiceMethod: ", error);
          reject(error);
        });
      }, 1000); // forkして少し待ってopen

      //HTTP Response は即時
      resolve(id);

    } else {
      resolve();
    }
  });
}

function getService(id?: string): Promise<ServiceInfo | ServiceInfo[]> {
  return new Promise<ServiceInfo | ServiceInfo[]>((resolve, reject) => {
    const action: ServiceWorkerAction = "get-service";
    if (id) {
      const service = services[id];
      if (service) {
        handleServiceMethod(service, action, id).then((response) => {
          const info: ServiceInfo = response.body as ServiceInfo;
          resolve(info);
        }).catch((error) => {
          logger.error("Error in getService handleServiceMethod: ", error);
          reject(error);
        });
      } else {
        resolve();
      }
    } else {
      const requests = Object.keys(services).map((id) => {
        return handleServiceMethod(services[id], action, id);
      });
      Promise.all(requests).then((responses) => {
        const results = responses.map((response) => {
          const info: ServiceInfo = response.body as ServiceInfo;
          return info;
        });
        resolve(results);
      }).catch((error) => {
        logger.error("Error in getService handleServiceMethod: ", error);
        reject(error);
      });
    }
  });
}

function deleteService(id: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (services[id]) {
      services[id].destroy();
      setTimeout(()=>{
        delete services[id];
        resolve(id);
      }, 1000);
    }
  });
}

function dispatchService(id: string): cluster.Worker {
  const service: cluster.Worker = services[id];
  return service;
}

function dispose() {
  Object.keys(services).forEach((id) => {
    services[id].destroy();
  });
}

process.on("uncaughtException", (error) => {
  try {
    logger.error("Error(uncaughtException)", error);
  } catch (error2) {
    console.error(error2);
    process.exit(1);
  }
});
process.on("unhandledRejection", (error) => {
  try {
    logger.error("Error(unhandledRejection)", error);
  } catch (error2) {
    console.error(error2);
    process.exit(1);
  }
});

if (cluster.isMaster) {
  //web-workerを作成
  const webWorker = cluster.fork({ web_process: true });
  logger.info("[Master] Web worker starts. ", {id: webWorker.id, pid: webWorker.process.pid});
  webWorker.on("message", (message: WorkerRequest) => {
    // logger.info("[Master] received message from web worker: ", message);
    const action = message.action;
    const id = message.id;
    const option = message.option;
    if (action === "create-service") {
      const slackBotOption = option as SlackBotOption;
      createService(id, slackBotOption).then((createdServiceId) => {
        const response: AtResponse = { result: true, body: createdServiceId };
        webWorker.send(response);
      }).catch((error) => {
        webWorker.send(error);
      });
    } else if (action === "get-service") {
      getService(id).then((serviceInfo: ServiceInfo | ServiceInfo[]) => {
        let response: AtResponse = null;
        if(serviceInfo) {
          response = { result: true, body: serviceInfo };
        } else {
          response = { result: true, body: serviceInfo };
        }
        webWorker.send(response);
      }).catch((error) => {
        webWorker.send(error);
      });
    } else if (action === "delete-service") {
      deleteService(id).then((deletedServiceId) => {
        const response: AtResponse = { result: true, body: deletedServiceId };
        webWorker.send(response);
      }).catch((error) => {
        webWorker.send(error);
      });
    } else if (action === "get-users") {
      const serviceWorker = dispatchService(id);
      const serviceAction: ServiceWorkerAction = "get-users";
      const setOption: ServiceWorkerOption = option;
      handleServiceMethod(serviceWorker, serviceAction, id).then((serviceResponse)=>{
        const response: AtResponse = { result: true, body: serviceResponse.body };
        webWorker.send(response);
      }).catch((error)=>{
        webWorker.send(error);
      });
    } else if (action === "slack-say") {
      const serviceWorker = dispatchService(id);
      const serviceAction: ServiceWorkerAction = "slack-say";
      const setOption: ServiceWorkerOption = option as Say;
      handleServiceMethod(serviceWorker, serviceAction, id, option).then((serviceResponse)=>{
        const response: AtResponse = { result: true };
        webWorker.send(response);
      }).catch((error)=>{
        webWorker.send(error);
      });

    } else if (action === "start-hear") {
      const serviceWorker = dispatchService(id);
      const serviceAction: ServiceWorkerAction = "start-hear";
      const setOption: ServiceWorkerOption = option as any;
      handleServiceMethod(serviceWorker, serviceAction, id, option).then((serviceResponse)=>{
        const response: AtResponse = { result: true, body: serviceResponse.body };
        webWorker.send(response);
      }).catch((error)=>{
        webWorker.send(error);
      });

    }else if (action === "stop-hear") {
      const serviceWorker = dispatchService(id);
      const serviceAction: ServiceWorkerAction = "stop-hear";
      const setOption: ServiceWorkerOption = option as any;
      handleServiceMethod(serviceWorker, serviceAction, id, option).then((serviceResponse)=>{
        const response: AtResponse = { result: true };
        webWorker.send(response);
      }).catch((error)=>{
        webWorker.send(error);
      });
      
    }else if(action === "get-callback") {
      const serviceWorker = dispatchService(id);
      const serviceAction: ServiceWorkerAction = "get-callback";
      const setOption: ServiceWorkerOption = option as any;
      handleServiceMethod(serviceWorker, serviceAction, id, option).then((serviceResponse)=>{
        const response: AtResponse = { result: true, body: serviceResponse.body };
        webWorker.send(response);
      }).catch((error)=>{
        webWorker.send(error);
      });

    }else if(action === "post-callback") {
      const serviceWorker = dispatchService(id);
      const serviceAction: ServiceWorkerAction = "post-callback";
      const setOption: ServiceWorkerOption = option as SlackCallback;
      handleServiceMethod(serviceWorker, serviceAction, id, setOption).then((serviceResponse)=>{
        const response: AtResponse = { result: true, body: "Processing now..."};
        webWorker.send(response);
      }).catch((error)=>{
        webWorker.send(error);
      });
    }

  });

  cluster.on("exit", function (worker, code, signal) {
    console.log("[Master] worker[" + worker.process.pid + "] was dead");
  });

  process.on("SIGINT", () => {
    for (let key in cluster.workers) {
      if (cluster.workers.hasOwnProperty(key)) {
        cluster.workers[key].kill();
      }
    }
  });

} else {
  //cluster forked childs
  if (process.env.web_process) {
    const port = config.web.port || 7000;
    const express = new ExpressServer(port);

    // process.on("exit", (signals) => {
    //   express.dispose();
    // });
    // process.on("message", (message) => {
    //   logger.info("message on worker ", message);
    // });

  } else if (process.env.service_process) {
    require("./slack/interaction");
  }

}


