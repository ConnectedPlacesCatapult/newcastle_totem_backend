const express = require('express')
const app = express()
const bodyParser = require('body-parser')
const { spawn } = require('child_process');

// Socket.IO
var dashboardServer = require("http").createServer();
var io = require("socket.io")(dashboardServer);

// Mongo
const MongoClient = require('mongodb').MongoClient;
const assert = require('assert');
var mdb; // stores persistent DB reference

// Log writing
var fs = require('fs');
var util = require('util');

// Logs new file monthly - store month names
const logMonths = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"]

// Init local data
const config = JSON.parse(fs.readFileSync('mainframe_config.json', 'utf8'));
var totems = JSON.parse(fs.readFileSync('../totem_details.json', 'utf8'));

// Store status of the mainframe for quick lookup on dashboard
// NOTE: Logs for this are stored locally and refreshed daily
var mainframeStatus = {}

var debug = false;

// TIMERS
var updateSensorsTimer = null;
var sourceSensorsTimer = null;
var updateILITimer = null;
var sourceILITimer = null;
var cleanILITimer = null;

//// SENSORS ///////////////////////////////////////////////////////////////////

// Fetches content for sensors, i.e. descriptions, taglines, and labels
function sourceSensors(retry=0, log=null) {

  // Clear the timers; we'll re-trigger them on completion
  clearTimeout(updateSensorsTimer);
  clearTimeout(sourceSensorsTimer);

  makeLogEntry("Sourcing sensor content - attempt " + (retry+1))

  // Call the function
  var script = spawn('python', ['../sensors/fetch_content.py'], {cwd: '../sensors'});

  var complete = false;

  // Initialise log if this is attempt 1
  if(log == null) {
    log = {
      timestamp: Date.now(),
      attempts: 1,
      success: false,
    }
  } else {
    log.attempts += 1;
  }

  // stdout should log warnings
  script.stdout.on('data', function(data) {
    if(!complete) {
      // Create warnings array if none
      if(log.warnings == undefined) {
        log.warnings = [];
      }
      log.warnings.push(data.toString());
    }
  });

  // stderr logs errors
  script.stderr.on('data', function(data) {
    if(!complete) {
      // Create errors array if none
      if(log.errors == undefined) {
        log.errors = [];
      }
      log.errors.push(data.toString());
    }
  });

  script.on("exit", function(code, sig) {
    complete = true;
    if(code == 0) {
      log.success = true;
    } else {
      if(log.errors == undefined) {
        log.errors = [];
      }
      log.errors.push("Exited with code " + code);
    }

    // Set the timer for next time
    if(log.success) {

      makeLogEntry("Successfully sourced sensor content", "S")

      // Save the log
      mongoInsertOne("logs_sensors_source", log)

      mainframeStatus.sourcing.sensors.live = true;
      mainframeStatus.sourcing.sensors.lastUpdated = Date.now();

      sourceSensorsTimer = setTimeout(function() { sourceSensors() }, getMillisecondsTilHour(config.sourceSensorsHour));
      updateSensors();

    } else {
      // If fail, retry twice, then raise an error and wait a day
      if(retry >= 2) {

        // Out of retries - raise alert
        // TODO

        makeLogEntry("Unable to source sensor content", "F")

        // Set timer to try next time
        sourceSensorsTimer = setTimeout(function() { sourceSensors() }, getMillisecondsTilHour(config.sourceSensorsHour))

        // Save the log
        mongoInsertOne("logs_sensors_source", log)

        mainframeStatus.sourcing.sensors.live = false;

        // Done for now - refresh sensors
        updateSensors();

      } else {
        // Wait 10 secs and retry
        makeLogEntry("Failed - retrying...", "F")
        sourceSensorsTimer = setTimeout(function() { sourceSensors(++retry) }, 10000)
      }
    }
  });
}

// Update sensors - should be called every 10 minutes
function updateSensors(retry=0, log=null) {

  makeLogEntry("Updating sensors - attempt " + (retry+1))

  // run update_sensors
  var script = spawn('python', ['../sensors/update_sensors.py'], {cwd: '../sensors'});

  // Completion flag to enforce synchronous execution; may be superfluous
  var complete = false;

  // Initialise log if this is attempt 1
  if(log == null) {
    log = {
      timestamp: Date.now(),
      attempts: 1,
      success: false,
    }
  } else {
    log.attempts += 1;
  }

  // stdout should log warnings
  script.stdout.on('data', function(data) {
    if(!complete) {
      // Create warnings array if none
      if(log.warnings == undefined) {
        log.warnings = [];
      }
      log.warnings.push(data.toString());
    }
  });

  // stderr logs errors
  script.stderr.on('data', function(data) {
    if(!complete) {
      // Create errors array if none
      if(log.errors == undefined) {
        log.errors = [];
      }
      log.errors.push(data.toString());
    }
  });

  script.on("exit", function(code, sig) {
    complete = true;
    if(code == 0) {
      log.success = true;
    } else {
      if(log.errors == undefined) {
        log.errors = [];
      }
      log.errors.push("Exited with code " + code);
    }

    // Set the timer for next time
    if(log.success) {
      // Set it to run at every [interval] mins past the hour, just for reliability
      updateSensorsTimer = setTimeout(function() { updateSensors() }, getMillisecondsTilMinute(config.updateSensorsMinuteInterval));

      // Save the log
      mongoInsertOne("logs_sensors_update", log)

      mainframeStatus.updates.sensors.live = true;
      mainframeStatus.updates.sensors.lastUpdated = Date.now();

      makeLogEntry("Successfully updated sensor content", "S")
    } else {
      // If fail, retry three times, then raise an alert and wait til the next interval
      if(retry >= 2) {
        // Out of retries - raise alert
        // TODO
        makeLogEntry("Unable to update sensor content", "F")

        // Save the log
        mongoInsertOne("logs_sensors_update", log)

        mainframeStatus.updates.sensors.live = false;

        // Set timer to try next time
        updateSensorsTimer = setTimeout(function() { updateSensors() }, getMillisecondsTilMinute(config.updateSensorsMinuteInterval));
      } else {
        // Wait 30 secs and retry
        makeLogEntry("Sensor update failed - retrying...", "F")
        updateSensorsTimer = setTimeout(function() { updateSensors(++retry, log) }, 30000)
      }
    }
  });
}

//// ILI ///////////////////////////////////////////////////////////////////////

// Source data - runs every day at 9am
function sourceILI(retry=0, log=null) {

  // Clear timers
  clearTimeout(updateILITimer);
  clearTimeout(sourceILITimer);
  clearTimeout(cleanILITimer);

  makeLogEntry("Sourcing ILI content - attempt " + (retry+1))

  // Call the function
  var script = spawn('python', ['../ili/data_sourcing.py'], {cwd: '../ili'});

  var complete = false;

  // Initialise log if this is attempt 1
  if(log == null) {
    log = {
      timestamp: Date.now(),
      attempts: 1,
      success: false,
    }
  } else {
    log.attempts += 1;
  }

  // stdout should log warnings
  script.stdout.on('data', function(data) {
    if(!complete) {
      // Create warnings array if none
      if(log.warnings == undefined) {
        log.warnings = [];
      }
      log.warnings.push(data.toString());
    }
  });

  // stderr logs errors
  script.stderr.on('data', function(data) {
    if(!complete) {
      // Create errors array if none
      if(log.errors == undefined) {
        log.errors = [];
      }
      log.errors.push(data.toString());
    }
  });

  script.on("exit", function(code, sig) {
    complete = true;
    if(code == 0) {
      log.success = true;
    } else {
      if(log.errors == undefined) {
        log.errors = [];
      }
      log.errors.push("Exited with code " + code);
    }


    // Set the timer for next time
    if(log.success) {
      makeLogEntry("Successfully sourced ILI content", "S")

      // If success, set timer for tomorrow at 8am
      sourceILITimer = setTimeout(function() { sourceILI() }, getMillisecondsTilHour(config.sourceILIHour));

      // Save the log
      mongoInsertOne("logs_ili_source", log)

      mainframeStatus.sourcing.ili.live = true;
      mainframeStatus.sourcing.ili.lastUpdated = Date.now();

      // Initialise data cleaning
      cleanILI();

    } else {
      // If fail, retry twice, then raise an error and wait a day
      if(retry >= 2) {
        // Out of retries - raise alert with admin
        // TODO
        makeLogEntry("Unable to source ILI content", "F")
        // Set timer to try next time
        sourceILITimer = setTimeout(function() { sourceILI() }, getMillisecondsTilHour(config.sourceILIHour))

        // Save the log
        mongoInsertOne("logs_ili_source", log)

        mainframeStatus.sourcing.ili.live = false;

        // Done for now - update ILI content with existing static data
        updateILI()
      } else {
        // Wait 10 secs and retry
        makeLogEntry("Failed to source ILI content - retrying...", "F")
        sourceILITimer = setTimeout(function() { sourceILI(++retry, log) }, 10000)
      }
    }
  });
}

// Clean data - runs after source data has successfully returned
function cleanILI(retry=0, log=null) {
  makeLogEntry("Cleaning ILI content - attempt " + (retry+1))

  // Call the function
  var script = spawn('python', ['../ili/data_cleaning.py'], {cwd: '../ili'});

  var complete = false;

  // Initialise log if this is attempt 1
  if(log == null) {
    log = {
      timestamp: Date.now(),
      attempts: 1,
      success: false,
    }
  } else {
    log.attempts += 1;
  }

  // stdout should log warnings
  script.stdout.on('data', function(data) {
    if(!complete) {
      // Create warnings array if none
      if(log.warnings == undefined) {
        log.warnings = [];
      }
      log.warnings.push(data.toString());
    }
  });

  // stderr logs errors
  script.stderr.on('data', function(data) {
    if(!complete) {
      // Create errors array if none
      if(log.errors == undefined) {
        log.errors = [];
      }
      log.errors.push(data.toString());
    }
  });

  script.on("exit", function(code, sig) {
    complete = true;
    if(code == 0) {
      log.success = true;
    } else {
      if(log.errors == undefined) {
        log.errors = [];
      }
      log.errors.push("Exited with code " + code);
    }

    // Set the timer for next time
    if(log.success) {
      makeLogEntry("Successfully cleaned ILI content", "S")

      // Save the log
      mongoInsertOne("logs_ili_clean", log)

      mainframeStatus.cleaning.ili.live = true;
      mainframeStatus.cleaning.ili.lastUpdated = Date.now();

      // Sourced and cleaned data - update ILI
      updateILI();

    } else {
      // If fail, retry twice, then raise an error and wait a day
      if(retry >= 2) {
        // Out of retries - raise alert with admin
        // TODO
        makeLogEntry("Unable to clean ILI content", "F")

        // Save the log
        mongoInsertOne("logs_ili_clean", log)

        mainframeStatus.cleaning.ili.live = false;

        // Done for now - update ILI content with existing static data
        updateILI()
      } else {
        // Wait 10 secs and retry
        makeLogEntry("Failed to clean ILI content - retrying...", "F")
        cleanILITimer = setTimeout(function() { cleanILI(++retry, log) }, 10000)
      }
    }
  });
}

// Call data - runs every 15 minutes
function updateILI(retry=0, log=null) {
  makeLogEntry("Updating ILI content - attempt " + (retry+1))

  // Call the function
  var script = spawn('python', ['../ili/data_call.py'], {cwd: '../ili'});

  var complete = false;

  // Initialise log if this is attempt 1
  if(log == null) {
    log = {
      timestamp: Date.now(),
      attempts: 1,
      success: false,
    }
  } else {
    log.attempts += 1;
  }

  // stdout should log warnings
  script.stdout.on('data', function(data) {
    if(!complete) {
      // Create warnings array if none
      if(log.warnings == undefined) {
        log.warnings = [];
      }
      log.warnings.push(data.toString());
    }
  });

  // stderr logs errors
  script.stderr.on('data', function(data) {
    if(!complete) {
      // Create errors array if none
      if(log.errors == undefined) {
        log.errors = [];
      }
      log.errors.push(data.toString());
    }
  });

  script.on("exit", function(code, sig) {
    complete = true;
    if(code == 0) {
      log.success = true;
    } else {
      if(log.errors == undefined) {
        log.errors = [];
      }
      log.errors.push("Exited with code " + code);
    }

    // Set the timer for next time
    if(log.success) {
      makeLogEntry("Successfully updated ILI content", "S")

      // Save the log
      mongoInsertOne("logs_ili_update", log)

      mainframeStatus.updates.ili.live = true;
      mainframeStatus.updates.ili.lastUpdated = Date.now();

      // Sourced and cleaned data - update ILI
      updateILITimer = setTimeout(function() { updateILI() }, getMillisecondsTilMinute(config.updateILIMinuteInterval));

    } else {
      // If fail, retry twice, then raise an error and wait a day
      if(retry >= 2) {
        // Out of retries - raise alert with admin
        // TODO
        makeLogEntry("Unable to update ILI content", "F")
        makeLogEntry(JSON.stringify(log));

        // Save the log
        mongoInsertOne("logs_ili_update", log)

        mainframeStatus.updates.ili.live = false;

        // Done for now - attempt to update next time
        updateILITimer = setTimeout(function() { updateILI() }, getMillisecondsTilMinute(config.updateILIMinuteInterval));
      } else {
        // Wait 10 secs and retry
        makeLogEntry("Failed - retrying...", "F")
        updateILITimer = setTimeout(function() { updateILI(++retry, log) }, 10000)
      }
    }
  });
}

//// UTIL //////////////////////////////////////////////////////////////////////

function getTimeRemaining(timeout) {
    return Math.ceil((timeout._idleStart + timeout._idleTimeout - Date.now()) / 1000);
}

// Given a 24-hour value for the hour, return milliseconds until then
function getMillisecondsTilHour(targetHour) {
  var now = new Date();

  // Get mins to hour
  var minsToHour = (60 - now.getMinutes());

  // Get hours to target hour
  var hoursToTarget = targetHour-(now.getHours()+1);

  // Handle the target being the next day
  if(hoursToTarget < 0) {
    hoursToTarget += 24
  }

  // Return milliseconds until target hour
  return 60000 * (minsToHour + (hoursToTarget * 60));
}

// Get milliseconds until specified minute interval past hour - keeps it reliable
// NOTE: Best to stick to factors of 60, and don't exceed 30!
function getMillisecondsTilMinute(minuteInterval) {
  var now = new Date();

  // Get mins to target
  var minsToInterval = (minuteInterval - (now.getMinutes() % minuteInterval));

  // Handle the target being the next day
  if(minsToInterval < 0) {
    minsToInterval += 60
  }

  // Return milliseconds until target hour
  return (minsToInterval * 60000);
}

function makeLogEntry(logText, pre="-") {

  var d = new Date();

  var day = d.getDate();
  if(day < 10) { day = "0" + day }

  var month = d.getMonth()+1;
  if(month < 10) { month = "0" + month }

  var hour = d.getHours();
  if(hour < 10) { hour = "0" + hour }

  var min = d.getMinutes();
  if(min < 10) { min = "0" + min }

  var fName = logMonths[d.getMonth()] + "-" + d.getFullYear() + ".log"

  var contents = day+"/"+month+" "+hour+":"+min+" "+pre+" "+logText;

  if(debug) {
    console.log(contents);
  }

  contents += "\n"

  fs.appendFile("logs/"+fName, contents, function(err) {
    if(err) {
      console.log("Error writing message log: " + err);
      return;
    }
  });
}

//// MONGO CONNECTION //////////////////////////////////////////////////////////
// TODO: Log mongo errors on the mainframe!

const mongoURL = 'mongodb://localhost:27017';
const mongoName = 'totem_backend';

function mongoExec(method, collection, data) {
  MongoClient.connect(mongoURL, function(err, client) {

    if(err) {
      makeLogEntry("MONGO CONNECTION FAILED", "F")
      makeLogEntry(JSON.stringify(err), "F");
      // TODO LOG ERROR FOR MAINFRAME
      return;
    }

    const db = client.db(mongoName)

    method(db, collection, data, function() {
      client.close()
    });

  });
}

function mongoInsertOne(collection, dataObj, callback=null) {
  const col = mdb.collection(collection);
  col.insert(dataObj, function(err, res) {
    if(err) {
      makeLogEntry("mongoInsertOne failed", "F")
      makeLogEntry(JSON.stringify(err), "F");
      // TODO raise status alert
      return;
    }
    if(callback) {
      callback(res);
    }
  });
}

function mongoInsertMany(collection, dataArray, callback=null) {
  const col = mdb.collection(collection);
  col.insertMany(dataArray, function(err, res) {
    if(err) {
      makeLogEntry("mongoInsertMany failed", "F")
      makeLogEntry(JSON.stringify(err), "F");
      // TODO raise status alert
      return;
    }
    if(callback) {
      callback(res);
    }
  });
}

function mongoFindCount(collection, query, callback) {
  const col = mdb.collection(collection);
  col.find(query).count(function(err, res) {
    if(err) {
      // TODO handle
    }
    callback(err, res);
  });
}

function mongoFind(collection, query, callback) {
  const col = mdb.collection(collection);
  col.find(query).toArray(function(err, res) {
    if(err) {
      // TODO handle
    }
    callback(err, res);
  });
}

function mongoFindLatest(collection, callback) {
  const col = mdb.collection(collection);
  col.find().limit(1).sort({_id:-1}).toArray(function(err, res) {
    callback(err, res[0]);
  });
}

//// MANAGEMENT ////////////////////////////////////////////////////////////////

// to is an array of notification types, e.g. "server", "totem", "general"...
// Defined in mainframe_config.json
function sendNotification(type, content=null) {
  var recipients = [];
  // TODO SEND NOTIFICATION
}

// Expect totems to send heartbeats every 5 minutes

function alertTotemDown(totemKey) {

  // Send notifications that totems are down
  sendNotification("totem_down")

  var t = totems[totemKey]

  // Log the status change in Mongo
  var stat = {
    status: false,
    timestamp: Date.now()
  }

  mongoInsertOne("logs_status_"+totemKey, stat, null)

  t.status.live = false;
}


var heartbeatTimers = {}
function resetHeartbeatTimer(totemKey, init=false) {

  var t = totems[totemKey];

  // Clear timer if exists
  if(totemKey in heartbeatTimers) {
    clearTimeout(heartbeatTimers[totemKey]);
  }

  // Status now true; if false (or null following initialisation), log that the totem is now live
  if(t.status.live == false || (t.status.live == null && !init)) {

    // Log the status change in Mongo
    var stat = {
      status: true,
      timestamp: Date.now()
    }

    mongoInsertOne("logs_status_"+totemKey, stat)

    t.status.live = true;

  }

  // Set new timer
  heartbeatTimers[totemKey] = setTimeout(function() { alertTotemDown(totemKey) }, config.minHeartbeatSilence * 60000)
}

//// DASHBOARD (socket.io) /////////////////////////////////////////////////////

// db.logs_ili_update.find({success:false, timestamp: { $gt: 1530255257410 } } ).count()

io.on('connection', function(socket){

  // Get timestamp for 4am today (start of totem content day)
  var tsToday = getTimestampAtHour(4);

  var dashboardInit = {};

  // Copy mainframe status
  dashboardInit.liveSince = mainframeStatus.liveSince;
  dashboardInit.totems = totems;

  // Send this content
  socket.emit("init_content", dashboardInit);

  // Get current ILI status
  // TODO choose a better way of doing this? And handle errors
  mongoFindCount("logs_ili_source", {warnings:{$exists:true}, timestamp: {$gt: tsToday}}, function(err, numWarnings) {
    if(!err) {
      mongoFindCount("logs_ili_source", {errors:{$exists:true}, timestamp: {$gt: tsToday}}, function(err, numErrors) {
        if(!err) {
          socket.emit("status_ili_source", {live: mainframeStatus.sourcing.ili.live, lastUpdated: mainframeStatus.sourcing.ili.lastUpdated, warnings: numWarnings, errors: numErrors});
        }
      })
    }
  });

  mongoFindCount("logs_ili_clean", {warnings:{$exists:true}, timestamp: {$gt: tsToday}}, function(err, numWarnings) {
    if(!err) {
      mongoFindCount("logs_ili_clean", {errors:{$exists:true}, timestamp: {$gt: tsToday}}, function(err, numErrors) {
        if(!err) {
          socket.emit("status_ili_clean", {live: mainframeStatus.cleaning.ili.live, lastUpdated: mainframeStatus.cleaning.ili.lastUpdated, warnings: numWarnings, errors: numErrors});
        }
      })
    }
  });

  mongoFindCount("logs_ili_update", {warnings:{$exists:true}, timestamp: {$gt: tsToday}}, function(err, numWarnings) {
    if(!err) {
      mongoFindCount("logs_ili_update", {errors:{$exists:true}, timestamp: {$gt: tsToday}}, function(err, numErrors) {
        if(!err) {
          socket.emit("status_ili_update", {live: mainframeStatus.updates.ili.live, lastUpdated: mainframeStatus.updates.ili.lastUpdated, warnings: numWarnings, errors: numErrors});
        }
      })
    }
  });

  // Sensors
  mongoFindCount("logs_sensors_source", {warnings:{$exists:true}, timestamp: {$gt: tsToday}}, function(err, numWarnings) {
    if(!err) {
      mongoFindCount("logs_sensors_source", {errors:{$exists:true}, timestamp: {$gt: tsToday}}, function(err, numErrors) {
        if(!err) {
          socket.emit("status_sensors_source", {live: mainframeStatus.sourcing.sensors.live, lastUpdated: mainframeStatus.sourcing.sensors.lastUpdated, warnings: numWarnings, errors: numErrors});
        }
      })
    }
  });

  mongoFindCount("logs_sensors_update", {warnings:{$exists:true}, timestamp: {$gt: tsToday}}, function(err, numWarnings) {
    if(!err) {
      mongoFindCount("logs_sensors_update", {errors:{$exists:true}, timestamp: {$gt: tsToday}}, function(err, numErrors) {
        if(!err) {
          socket.emit("status_sensors_update", {live: mainframeStatus.updates.sensors.live, lastUpdated: mainframeStatus.updates.sensors.lastUpdated, warnings: numWarnings, errors: numErrors});
        }
      })
    }
  });

  // Totems - interactions and dropout counts for each
  for(k in totems) {
    sendTotemStatus(k, socket);
  }

  //// ADMIN CREDENTIALS - todo, v v basic & insecure

  // const pHash =
  // Will be of the form hash: timestamp of expiry. Check before any command
  const accessTokens = {}


  socket.on("login", function(data) {
    // Confirm login credentials
    socket.emit("login_accepted");
  });

  function isAuthorised(token) {
    if(token in accessTokens) {
      if(accessTokens[token] < Date.now()) {
        return true;
      }
      // Remove expired token
      delete accessTokens[token];
    }
    return false;
  }

  //// TOTEM COMMANDS
  socket.on("totem_command", function(data) {
    if(isAuthorised(data.token)) {
      addTotemCommand(data)
      // TODO callback to confirm that it's been queued
      socket.emit("totem_command_queued");
    } else {
      socket.emit("logout");
    }
  });

  socket.on("update_totem_config", function(data) {
    if(true || isAuthorised(data.token)) {
      if(data.key in totems) {

        // Check if we need to update the controller and queue updates
        // TODO This is just a quick-and-dirty approach; individual methods may be preferable
        var contConf = data.config.controllerConfig;
        for(var attr in contConf) {
          if(contConf[attr] != totems[data.key].controllerConfig[attr]) {
            // There has been an update - queue it
            var update = {
              type: "config",
              totemKey: data.key,
              config: Object.assign({}, contConf)
            }

            addTotemCommand(update)
            break;
          }
        }

        // Update the local var
        totems[data.key] = data.config;

        // Update the config file
        updateTotemDetails()

        // TODO callback to confirm that it's been queued
        // Include current queued instructions
        var res = {
          success: true,
          queue: Object.assign([], totemCommands[data.totemKey])
        }

        socket.emit("update_totem_config", res);



      } else {
        var res = {
          success: false,
          error: "Totem " + (data.key) + " not recognised",
        }
        socket.emit("update_totem_config", res);
      }

    } else {
      socket.emit("logout");
    }
  });

  //// LOGS

  // Get generic logs (no query)
  socket.on("request_day_logs", function(collection) {

    var tsToday = getTimestampAtHour(4);

    mongoFind(collection, {timestamp: {$gt: tsToday}}, function(err, data) {
      if(!err) {
        // TODO error handling
        socket.emit("day_logs", data);
      }
    });
  });

  // Get interaction logs for today
  socket.on("request_day_interaction_logs", function(totemKey) {
    var tsToday = getTimestampAtHour(4);
    mongoFind("logs_navigation_"+totemKey, {trigger: {$ne: "auto"}, timestamp: {$gt: tsToday}}, function(err, navData) {
      if(!err) {
        // TODO error handling
        // Specify that these are navigation
        for(var i = 0; i < navData.length; i++) {
          navData[i].type = "NAVIGATION";
        }
        mongoFind("logs_interaction_"+totemKey, {trigger: {$ne: "auto"}, timestamp: {$gt: tsToday}}, function(err, intData) {
          if(!err) {
            // Specify that these are interaction
            for(var i = 0; i < intData.length; i++) {
              intData[i].type = "INTERACTION";
            }

            // Concat the results together and sort by timestamp descending
            var data = navData.concat(intData);
            data.sort(function(a, b) {
              return a.timestamp - b.timestamp;
            });

            socket.emit("day_logs", data);
          }
        });
      }
    });
  });

  // Get logs for the scripts (errors and warnings)
  socket.on("request_script_logs", function(collection) {

    var tsToday = getTimestampAtHour(4);

    mongoFind(collection, {timestamp: {$gt: tsToday}, $or: [ {warnings:{$exists:true}}, {errors:{$exists:true}} ]}, function(err, data) {
      if(!err) {
        // TODO error handling
        socket.emit("script_logs", data);
      }
    });
  });

  socket.on("disconnect", function() {

  });


  function sendTotemStatus(k, socket) {
    console.log("Sending status for " + k);

    // TODO move totem status to another data object?
    var stat = Object.assign({}, totems[k].status)
    stat.totemKey = k;
    stat.dropouts = 0;
    stat.interactions = 0;

    mongoFindCount("logs_status_"+k, {status:false, timestamp: {$gt: tsToday}}, function(err, numDrops) {
      if(!err) {
        stat.dropouts = numDrops;
        var interactions = 0;
        mongoFindCount("logs_navigation_"+k, {trigger:{$ne: "auto"}, timestamp: {$gt: tsToday}}, function(err, navs) {
          if(!err) {
            stat.interactions += navs;
            mongoFindCount("logs_interaction_"+k, {trigger:{$ne: "auto"}, timestamp: {$gt: tsToday}}, function(err, ints) {
              if(!err) {
                stat.interactions += ints;
                socket.emit("status_totem", stat)
              }
            });
          }
        });
      }
    });
  }

  // socket.on("call_name", function(params) {
  //
  // });

});




// Get the timestamp for a given hour, from the past 24 hours
function getTimestampAtHour(targetHour) {
  var d = new Date();
  var tsToday = d.getTime();

  var hr = d.getHours() - targetHour;
  if(hr < 0) {
    hr += 24;
  }

  // Subtract time since targetHour to get timestamp for this time
  tsToday -= ((hr * 60) + d.getMinutes()) * 60000;

  return tsToday;
}

//// ANALYTICS API ///////////////////////////////////////////////////////////

app.use( bodyParser.json() );
app.use( bodyParser.urlencoded({ extended: true }));

app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

app.post('/', function(req, res) {
  resObj = {
    error: "Invalid post - totem analytics should be sent to /analytics"
  }
  res.send(resObj);
});

// Analytics updates are expected every 15 minutes minimum
app.post('/analytics', function(req, res) {

  // EXPECTED BODY:
  /*
  {
    totemKey: [totem key]
    navigation: [   // Optional
      {
        timestamp
        page
        subpage
        trigger: button, touch, auto
        from_page: screensaver_ili, screensaver_uo, screensaver_partner...
      },
      ... IN TEMPORAL ORDER, probably one at a time
    ],
    interaction: [   // Optional
      {
        timestamp
        page
        subpage
        trigger: button, touch
        element_id        - DOM ID of the clicked element (e.g. 'curious route' button)
        x                 - X position if event_source is "touch"
        y                 - Y position if event_source is "touch"
      },
      ...
    ]
  }
  */

  if(confirmTotemExists(req, res)) {

    var resObj = {}

    // Update this totem's heartbeat monitor
    var t = totems[req.body.totemKey];

    // Reset the heartbeat timer
    resetHeartbeatTimer(req.body.totemKey);

    // Log this as the most recent update
    t.status.lastContact = Date.now();

    // Unpack any navigation data
    if("navigation" in req.body) {

      // Clean the data first - convert timestamp to int, nullify empty strings
      var n;
      for(var i = 0; i < req.body.navigation.length; i++) {
        n = req.body.navigation[i];
        n.timestamp = parseInt(n.timestamp);
        if(n.subpage == "") { n.subpage = null; }
      }

      // TODO handle log insert error
      mongoInsertMany("logs_navigation_" + req.body.totemKey, req.body.navigation);

      // Save the totem's current page locally; easier access when needed
      var lastNav = req.body.navigation[req.body.navigation.length-1];
      t.status.curPage = lastNav.page

      // Handle subpage, if exists
      if(lastNav.subPage) {
        t.status.curPge += " - " + lastNav.subPage;
      }

      // Update this as the last interaction
      if(t.status.lastInteraction == null || lastNav.timestamp > t.status.lastInteraction) {
        t.status.lastInteraction = lastNav.timestamp;
      }
    }

    // Unpack any interaction data
    if("interaction" in req.body) {

      // First we have to convert all timestamps to ints and empty strings to null
      for(var i = 0; i < req.body.interaction.length; i++) {
        n = req.body.interaction[i];
        n.timestamp = parseInt(n.timestamp);

        if(n.subpage == "") { n.subpage = null; }
        if(n.element_id == "") { n.element_id = null; }
      }

      mongoInsertMany("logs_interaction_" + req.body.totemKey, req.body.interaction);

      var lastInteraction = req.body.interaction[req.body.interaction.length-1].timestamp;
      if(t.status.lastInteraction == null || lastInteraction > t.status.lastInteraction) {
        t.status.lastInteraction = lastInteraction;
      }
    }

    resObj.success = "true"

    // UPDATES:
    // Opportunity to send any updates in return
    // config: New config file
    //
    // UPDATES should have a timestamp associated with them and they should be
    // confirmed by the totem once they have been successfully applied

    // Attempt to send all updates
    if(req.body.totemKey in totemCommands) {
      console.log("Sending totem commands to " + req.body.totemKey);
      resObj.commands = totemCommands[req.body.totemKey];
    }

    res.send(resObj);
  }
});

// TOTEMS POST TO THIS WITH THE TIMESTAMP OF THE LATEST APPLIED UPDATE
app.post('/confirm-commands', function(req, res) {
  if(confirmTotemExists(req, res) && req.body.totemKey in totemCommands) {
    // Run through the updates and remove them
    var tKey = req.body.totemKey;



    if("updated_to" in req.body) {
      var updatedTo = parseInt(req.body.updated_to);

      console.log("Got confirmation up to " + updatedTo + " for totem " + tKey)

      // Iterate backwards since we're deleting array elements in-place
      for(var i = totemCommands[tKey].length-1; i >= 0; i--) {
        if(totemCommands[tKey][i].timestamp <= updatedTo) {
          totemCommands[tKey].splice(i, 1);
        }
      }

      // If we're out of updates, remove the entry entirely
      if(totemCommands[tKey].length == 0) {
        delete totemCommands[tKey];
      }

    }
    res.send(null);
  }
});

function confirmTotemExists(req, res) {
  if(!("totemKey" in req.body)) {
    res.send({error: "Missing 'totemKey' field"});
    return false;
  } else if (!(req.body.totemKey in totems)) {
    res.send({error: "Totem key " + req.body.totemKey + " not recognised"});
    return false;
  } else if(totems[req.body.totemKey].active == false) {
    res.send({error: "Totem " + req.body.totemKey + " is set 'inactive' in the config; disregarding"});
    return false;
  }
  return true;
}

// Status alerts should trigger the appropriate notifications
app.post('/status', function(req, res) {
  // TODO handle a status alert
  makeLogEntry("Status alert for " + req.body.totemKey + ": " + req.body.alert, "!");
});

//// TOTEM UPDATES /////////////////////////////////////////////////////////////

/*
Updates: Applied to the config file for the controller
{
  "type": [config, call, any other]
  "totemKey"
  "displayURL"
  "heartbeatInterval"
  "analyticsEndpoint"
  "statusEndpoint"
}

Commands: Functions to be executed
{
  e.g. playing sound, opening socket, downloading feedback
}
*/

var totemCommands = {};

// Form a queue of totem commands, marked by timestamp
function addTotemCommand(data) {

  console.log("Adding totem command");
  console.log(data);
  if(!(data.totemKey in totemCommands)) {
    totemCommands[data.totemKey] = [];
  }

  data.timestamp = Date.now();

  totemCommands[data.totemKey].push(data);
}

//// SERVER INITIALISATION /////////////////////////////////////////////////////

MongoClient.connect(mongoURL, function(err, client) {
  if(err) {
    makeLogEntry("MONGO CONNECTION FAILED", "F")
    makeLogEntry(JSON.stringify(err), "F");
    // TODO LOG ERROR FOR MAINFRAME!
    process.exit();
  }

  mdb = client.db(mongoName);

  // Begin mainframe initialisation
  initMainframe();

  // Start analytics endpoints
  app.listen(3000, () => console.log('Analytics listening on port 3000'))

  // Start dashboard socket listener
  dashboardServer.listen(3001, () => console.log("Dashboard socket listening on port 3001"));
});

function initMainframe() {

  makeLogEntry(" *** RESTARTING MAINFRAME *** ")

  // Init mainframe status
  initMainframeStatus();


  // Init totem status logging
  for(var t in totems) {

    initTotemStatus(t);

    // Set the heartbeat timer for this totem, with "init" flag set
    // Totem status will remain "null" until a reliable status is received
    // Only set heartbeat timer for active totems
    if(totems[t].active) {
      resetHeartbeatTimer(t, true);
    }
  }

  // Check debug
  if(process.argv.includes("debug")) {
    debug = true;
  }

  if(process.argv.includes("init")) {
    makeLogEntry("Init command set - refreshing all content");
    refreshAll();
    //updateSensors();
    //updateILI();
  } else if(process.argv.includes("test")) {
    console.log("Running test");

  } else {
    // Set timers for regular updates
    makeLogEntry("No init command given; commencing regular updates")

    // Update initially
    updateSensors();
    updateILI();

    // updateSensorsTimer = setTimeout(function() { updateSensors() }, getMillisecondsTilMinute(config.updateSensorsMinuteInterval));
    // updateILITimer = setTimeout(function() { updateILI() }, getMillisecondsTilMinute(config.updateILIMinuteInterval));

    // Set daily downloads
    sourceSensorsTimer = setTimeout(function() { sourceSensors() }, getMillisecondsTilHour(config.sourceSensorsHour));
    sourceILITimer = setTimeout(function() { sourceILI() }, getMillisecondsTilHour(config.sourceILIHour));
  }
}

function initMainframeStatus() {

  mainframeStatus = {
    liveSince: Date.now(),
    updates: {
      ili: {
        live: false,
        lastUpdated: null,
      },
      sensors: {
        live: false,
        lastUpdated: null,
      }
    },
    sourcing: {
      ili: {
        live: false,
        lastUpdated: null,
      },
      sensors: {
        live: false,
        lastUpdated: null,
      }
    },
    cleaning: {
      ili: {
        live: false,
        lastUpdated: null,
      }
    }
  }


  var tsToday = getTimestampAtHour(4);

  // ILI source
  mongoFindLatest("logs_ili_source", function(err, res) {
    if(res) {
      if(res.timestamp > tsToday && res.success == true) {
        mainframeStatus.sourcing.ili.live = true;
      }
      mainframeStatus.sourcing.ili.lastUpdated = res.timestamp;
    }
  });

  // ILI clean
  mongoFindLatest("logs_ili_clean", function(err, res) {
    if(res) {
      if(res.timestamp > tsToday && res.success == true) {
        mainframeStatus.cleaning.ili.live = true;
      }
      mainframeStatus.cleaning.ili.lastUpdated = res.timestamp;
    }
  });

  // ILI update - get timestamp for update interval
  var checkILITime = Date.now() - (60000*config.updateILIMinuteInterval)
  mongoFindLatest("logs_ili_update", function(err, res) {
    if(res) {
      if(res.timestamp > checkILITime && res.success == true) {
        mainframeStatus.updates.ili.live = true;
      }
      mainframeStatus.updates.ili.lastUpdated = res.timestamp;
    }
  });

  // Sensors source
  mongoFindLatest("logs_sensors_source", function(err, res) {
    if(res) {
      if(res.timestamp > tsToday && res.success == true) {
        mainframeStatus.sourcing.sensors.live = true;
      }
      mainframeStatus.sourcing.sensors.lastUpdated = res.timestamp;
    }
  });

  // Sensors update
  var checkSensorsTime = Date.now() - (60000*config.updateSensorsMinuteInterval)
  mongoFindLatest("logs_sensors_update", function(err, res) {
    if(res) {
      if(res.timestamp > checkSensorsTime && res.success == true) {
        mainframeStatus.updates.sensors.live = true;
      }
      mainframeStatus.updates.sensors.lastUpdated = res.timestamp;
    }
  });
}

function initTotemStatus(key) {

  totems[key].status = {
    live: null,
    lastContact: null,
    curPage: null,
    lastInteraction: null
  }

  mongoFindLatest("logs_status_"+key, function(err, res) {
    if(res) {
      totems[key].status.live = res.status;
    }
  });

  mongoFindLatest("logs_navigation_"+key, function(err, res) {
    if(res) {
      totems[key].status.curPage = res.page;
      if(res.subpage) {
        totems[key].status.curPage += "_" + res.subpage;
      }

      totems[key].status.lastInteraction = res.timestamp;

      mongoFindLatest("logs_interaction_"+key, function(err, res) {
        if(res) {
          if(res.timestamp > totems[key].status.lastInteraction) {
            totems[key].status.lastInteraction = res.timestamp;
          }
        }
      })
    }
  });
}

// Refreshses all content by sourcing, cleaning, and uploading updates
function refreshAll() {

  makeLogEntry("Refreshing all content")

  // Source sensor content
  sourceSensors();

  // Source ILI content
  sourceILI();
}

// Write the totem config to file, e.g. after an update from the portal
function updateTotemDetails() {
  fs.writeFileSync("../totem_details.json", JSON.stringify(totems));
}
