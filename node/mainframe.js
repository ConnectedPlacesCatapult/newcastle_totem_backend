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
var mainframeStatus = {
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

      mainframeStatus.sourcing.ili.live = true;
      mainframeStatus.sourcing.ili.lastUpdated = Date.now();

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

        mainframeStatus.sourcing.ili.live = false;

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

//// MANAGEMENT ////////////////////////////////////////////////////////////////

// to is an array of notification types, e.g. "server", "totem", "general"...
// Defined in mainframe_config.json
function sendNotification(type, content=null) {
  var recipients = [];
  // TODO SEND NOTIFICATION
}

// Expect totems to send heartbeats every 5 minutes

function alertTotemDown(totem_key) {

  // Send notifications that totems are down
  sendNotification("totem_down")

  var t = totems[totem_key]

  // Log the status change in Mongo
  var stat = {
    status: false,
    timestamp: Date.now()
  }

  mongoInsertOne("logs_status_"+totem_key, stat, null)

  t.status.live = false;
}

function resetHeartbeatTimer(totem_key, init=false) {

  var t = totems[totem_key];

  // Create timer if not exists
  if(t.heartbeatTimer) {
    clearTimeout(t.heartbeatTimer);
  }

  // Status now true; if false (or null following initialisation), log that the totem is now live
  if(t.status.live == false || (t.status.live == null && !init)) {

    // Log the status change in Mongo
    var stat = {
      status: true,
      timestamp: Date.now()
    }

    mongoInsertOne("logs_status_"+totem_key, stat)

    t.status.live = true;

  }

  // Set new timer
  t.heartbeatTimer = setTimeout(function() { alertTotemDown(totem_key) }, config.minHeartbeatSilence * 60000)
}

//// DASHBOARD (socket.io) /////////////////////////////////////////////////////

// db.logs_ili_update.find({success:false, timestamp: { $gt: 1530255257410 } } ).count()

io.on('connection', function(socket){

  console.log("Got a connection");

  // Get timestamp for 4am today (start of totem content day)
  //var tsToday = getTimestampAtHour(4);

  var dashboardInit = {};

  // Copy mainframe status
  dashboardInit.mainframe = mainframeStatus;
  dashboardInit.totems = totems;

  //mongoFindCount("logs_ili_source", {warnings:{$exists:true}, timestamp: {$gt: tsToday}}, function(err, res) {

  //// Continue from this point
  // TODO Count attempts or warnings, return that value too
  // TODO Create full initContent packet and send
  // TODO Build dashboard page from initContent
  // TODO Link up controls to request log data

  //  - Time and status of last ILI sourcing
  //  - Number of fails today

  //  - Time and status of last ILI cleaning
  //  - Number of fails today

  //  - Time and status of last ILI update
  //  - Number of fails today

  //  - Time and status of last sensors sourcing
  //  - Number of fails today

  //  - Time and status of last sensors update
  //  - Number of fails today

  //  - Totem details and their status
  //  - Number of dropouts today

  // Send the content

  socket.emit("initContent", dashboardInit);

  socket.on("disconnect", function() {

  });

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

  resObj = {}

  // EXPECTED BODY:
  /*
  {
    totem_key: [totem key]
    navigation: [
      {
        timestamp
        page
        subpage
        trigger: button, touch, auto
        from_page: screensaver_ili, screensaver_uo, screensaver_partner...
      },
      ... IN TEMPORAL ORDER, probably one at a time
    ],
    interaction: [
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

  // Confirm we have an ID
  if(!("totem_key" in req.body)) {
    resObj.error = "Missing 'totem_key' field";
    res.send(resObj);
    return;
  } else if (!(req.body.totem_key in totems)) {
    resObj.error = "Totem key " + req.body.totem_key + " not recognised";
    res.send(resObj);
    return;
  } else if(totems[req.body.totem_key].active == false) {
    resObj.error = "Totem " + req.body.totem_key + " is set 'inactive' in the config; disregarding";
    res.send(resObj);
    return;
  }

  // Update this totem's heartbeat monitor
  var t = totems[req.body.totem_key];

  // Reset the heartbeat timer
  resetHeartbeatTimer(req.body.totem_key);

  // Log this as the most recent update
  t.status.lastContact = Date.now();

  // Unpack any navigation data
  if("navigation" in req.body) {
    // TODO handle log insert error
    mongoInsertMany("logs_navigation_" + req.body.totem_key, req.body.navigation);

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
    mongoInsertMany("logs_interaction_" + req.body.totem_key, req.body.interaction);

    var lastInteraction = req.body.interaction[req.body.interaction.length-1].timestamp;
    if(t.status.lastInteraction == null || lastInteraction > t.status.lastInteraction) {
      t.status.lastInteraction = lastInteraction;
    }
  }

  resObj.success = "true"

  // TODO
  // Opportunity to send any updates in return

  res.send(resObj);
});

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

  // Init totem status logging
  for(var t in totems) {
    totems[t].status = {
      live: null,
      lastContact: null,
      curPage: null,
      lastInteraction: null
    }

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

// Refreshses all content by sourcing, cleaning, and uploading updates
function refreshAll() {

  makeLogEntry("Refreshing all content")

  // Source sensor content
  sourceSensors();

  // Source ILI content
  sourceILI();
}
