
import * as Express from "express";
import * as Http from "http";
import * as Https from "https";
import * as fs from "fs";
import * as parser from "body-parser";
import * as swaggerUi from "swagger-ui-express";

import Router = Express.Router;
import {BotAPIServer} from "./slack/bot-api";

const settings = require("../settings.json");
const YAML = require("yamljs");
const swaggerDocument = YAML.load("./swagger.yaml");

export class ExpressServer {
    slackbot: BotAPIServer = null;

    constructor(port: number) {
        const app: Express.Application = Express();
        let server: Https.Server|Http.Server = null;
        if(settings.ssl && settings.ssl.key && settings.ssl.cert) {
            server = Https.createServer({
                key: fs.readFileSync(settings.ssl.key),
                cert: fs.readFileSync(settings.ssl.cert),
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
        this.slackbot && this.slackbot.dispose();
    }
    
}

