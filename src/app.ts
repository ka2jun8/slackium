import { ExpressServer } from "./express";
// import { SlackBotWrapper, Vevent } from "./slack/slack";

const settings = require("../settings.json");

const port = settings.web.port || 7000;
const express = new ExpressServer(port);

process.on("SIGINT", function () {
  console.log("shutting down from SIGINT (Ctrl+C)");
  express.dispose();
  process.exit();
});
