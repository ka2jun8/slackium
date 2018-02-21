
import * as Express from "express";
import * as Http from "http";
import * as Https from "https";
import * as fs from "fs";
import * as parser from "body-parser";
import * as swaggerUi from "swagger-ui-express";

import Router = Express.Router;
import {BotAPIServer} from "./slack/webWorker";
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
            label: process.env._file_label,
            json: process.env._file_json === "true",
        }
    }
  };
}

const YAML = require("yamljs");
const swaggerDocument = YAML.load("./swagger.yaml");

export class ExpressServer {
    slackbot: BotAPIServer = null;

    constructor(port: number) {
        const app: Express.Application = Express();
        let server: Https.Server|Http.Server = null;
        if(config.ssl && config.ssl.key && config.ssl.cert) {
            server = Https.createServer({
                key: fs.readFileSync(config.ssl.key),
                cert: fs.readFileSync(config.ssl.cert),
            }, app);
        }else {
            server = Http.createServer(app);
        } 
        const router = Router();

        app.use(parser.json());
        app.use(parser.urlencoded({ extended: false }));

        // app.use(Express.static("public"));
        // app.get("/", (req, res) => {
        //     res.sendFile(__dirname + "/public/index.html");
        // });

        app.use(
            "/api-docs", 
            swaggerUi.serve, 
            swaggerUi.setup(swaggerDocument, {explorer : true}),
        ); 

        router.get("/version", (req, res) => {
            res.send("API latest version: 1");
        });

        this.slackbot = new BotAPIServer(server, router);

        app.use((req, res, next) => {
            res.header("Access-Control-Allow-Origin", "*");
            res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
            next();
        });

        app.use("/api/v1", router);
        server.listen(port, () => console.log("start server with port ["+ port +"]"));
    }

    dispose() {
        // this.slackbot && this.slackbot.dispose();
    }
    
}

