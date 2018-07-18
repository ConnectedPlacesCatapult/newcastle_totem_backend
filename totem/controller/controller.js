const express = require('express')
const app = express()
const fs = require("fs");
const util = require("util");
const request = require("request");
const bodyParser = require('body-parser')
const childProcess = require('child_process');

// TODO error handling if config is malformed?
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

// Initialise pageHeartbeatTimer; allow 30 seconds for the page to send the call
var pageHeartbeatTimer = setTimeout(function() { alertPageDown(); }, config.heartbeatInterval + config.heartbeatAlertPeriod)

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
  req.body.totemKey = config.totemKey;

  // Set up object to send to frontend - will include any new config settings
  resObj = {}
  resObj.heartbeatInterval = config.heartbeatInterval;

  // Send analytics data to the backend
  sendUpdate(req.body, function(e, r) {
    if(!e  && !("error" in r.body)) {

      // Handle any commands from the response
      if("commands" in r.body) {
        // Run through applying all updates, making note of latest timestamp
        var commandTimestamp = 0;

        var command;
        var newConfig = false;
        for(var i = 0; i < r.body.commands.length; i++) {
          command = r.body.commands[i];

          switch(command.type) {
            case "config": // Handle config updates
              updateConfig(command.config);
              newConfig = true;
              break;
            default:
              break;
          }

          // Update the timestamp for the latest-seen command
          if(command.timestamp > commandTimestamp) {
            commandTimestamp = command.timestamp;
          }

        }

        // Apply config file - update settings and save to config file
        if(newConfig) {
          applyConfig();

          // Send relevant config settings to the frontend to be applied
          resObj.displayURL = config.displayURL;
          resObj.heartbeatInterval = config.heartbeatInterval;
        }

        // Confirm commands received
        confirmCommands(commandTimestamp);
      }

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
  pageHeartbeatTimer = setTimeout(function() { alertPageDown(); }, config.heartbeatInterval + config.heartbeatAlertPeriod);

});

app.listen(3000, function(){
  console.log('Totem controller listening on port 3000')
});

//// CHROME MAINTENANCE ////////////////////////////////////////////////////////

function resetChrome() {
  // Close any existing versions of Chrome
  var closeChrome = childProcess.exec('TASKKILL /IM /F chrome.exe', function(error, stdout, stderr) {

    if (error) { console.error('exec error: ', error); }

    // Run chrome in kiosk mode
    var chromeKiosk = childProcess.exec('start chrome --kiosk ' + config.displayURL);
    chromeKiosk.on('error', function(err) {
      // TODO handle
      console.log("Chrome Kiosk error: ", err);
    });
  });
}

// INITIALISE CHROME

resetChrome();

////////////////////////////////////////////////////////////////////////////////

// Critical alert! The page is for some reason unresponsive
function alertPageDown() {
  // TODO
  // Set up the post to the mainframe
  var data = {
    "totemKey":config.totemKey,
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

function confirmCommands(timestamp) {
  var data = {
    totemKey: config.totemKey,
    updated_to: timestamp
  }
  request.post(
    config.confirmCommandsEndpoint,
    { json: data },
    function(err, res, body) {
      // TODO currently no need to handle this response; failed confirmation will just be reattempted later
    }
  )

}

function updateConfig(newConfig) {
  for(c in newConfig) {
    config[c] = newConfig[c];
  }
}

function applyConfig() {
  fs.writeFileSync("config.json", JSON.stringify(config));
}
