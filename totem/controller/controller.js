const express = require('express')
const app = express()
const fs = require("fs");
const util = require("util");
const request = require("request");
const bodyParser = require('body-parser')
const { spawn } = require('child_process');

// TODO error handling if config is malformed?
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

// Initialise pageHeartbeatTimer; allow 10 seconds for the page to send the call
var pageHeartbeatTimer = setTimeout(function() { alertPageDown(); }, config.heartbeatInterval + 10000)

app.use( bodyParser.json() );
app.use( bodyParser.urlencoded({ extended: true }));

app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

// Web should attempt to post to localhost
app.post('/', function(req, res){

  // Add any controller status updates, TODO
  //  - Controller status separate to web status?
  req.body.totem_key = config.totem_key;

  // Set up object to send to frontend - will include any config settings
  resObj = {}
  resObj.heartbeatInterval = config.heartbeatInterval;

  // Send analytics data to the backend
  sendUpdate(req.body, function(e, r) {
    if(!e  && !("error" in r.body)) {
      resObj.success = true;
      res.send(resObj);
    } else {
      // TODO handle errors
      console.log("Update error");
      console.log(e);
      console.log(r);
      resObj.error = e;
      res.send(resObj);
    }
  });

  // Set our web heartbeat timer to fire an alert if the web page is silent for 30 secs more than we expect
  clearTimeout(pageHeartbeatTimer);
  pageHeartbeatTimer = setTimeout(function() { alertPageDown(); }, config.heartbeatInterval + 30000);

});

app.listen(3000, function(){
  console.log('Totem controller listening on port 3000')
});

//// CHROME MAINTENANCE ////////////////////////////////////////////////////////

const chromeKiosk = spawn('start chrome',['--kiosk', config.display_url]);

////////////////////////////////////////////////////////////////////////////////

// Critical alert! The page is for some reason unresponsive
function alertPageDown() {
  // TODO
  // Set up the post to the mainframe
  var data = {
    "totem_key":config.totem_key,
    "alert":"Page has missed a heartbeat!",
  }

  request.post(
    config.statusEndpoint,
    { json: data },
    function (error, response, body) {
      // callback(error, response);
    }
  );
}

function sendUpdate(data, callback) {

  // Set up the post to the mainframe
  request.post(
    config.analyticsEndpoint,
    { json: data },
    function (error, response, body) {
      callback(error, response);
    }
  );
}
