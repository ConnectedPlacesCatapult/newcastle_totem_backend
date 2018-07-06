// HANDLES ALL CONNECTION TO MAINFRAME
var socket;
const addr = "http://52.56.231.86:3001"

var totems = null;

function makeConnection() {
  socket = io(addr);

  socket.io.on('connect_error', function(e) {
    // Server is down!
    document.getElementById("server-timestamp").innerHTML = "Could not connect!";
    document.getElementById("server-status-dot").className = "status down";
    socket.disconnect();
  });

  socket.on('init_content', function(data) {
    // Set server status
    document.getElementById("server-status-dot").className = "status live";
    document.getElementById("server-timestamp").innerHTML = "Last restarted " + getReadableTimeSince(data.liveSince);

    totems = data.totems;
    // Set up totems DOM
    for(t_key in totems) {
      createTotemTile(t_key, totems[t_key]);
    }

  });

  socket.on("status_ili_source", function(data) {
    document.getElementById("ili-source-status").innerHTML = getStatusString(data);
    if(data.lastUpdated) {
      document.getElementById("ili-source-timestamp").innerHTML = "Last updated " + getReadableTimeSince(data.lastUpdated);
    }
  })

  socket.on("status_ili_clean", function(data) {
    document.getElementById("ili-clean-status").innerHTML = getStatusString(data);
    if(data.lastUpdated) {
      document.getElementById("ili-clean-timestamp").innerHTML = "Last updated " + getReadableTimeSince(data.lastUpdated);
    }
  })

  socket.on("status_ili_update", function(data) {
    document.getElementById("ili-update-status").innerHTML = getStatusString(data);
    if(data.lastUpdated) {
      document.getElementById("ili-update-timestamp").innerHTML = "Last updated " + getReadableTimeSince(data.lastUpdated);
    }
  })

  socket.on("status_sensors_source", function(data) {
    document.getElementById("sensors-source-status").innerHTML = getStatusString(data);
    if(data.lastUpdated) {
      document.getElementById("sensors-source-timestamp").innerHTML = "Last updated " + getReadableTimeSince(data.lastUpdated);
    }
  })

  socket.on("status_sensors_update", function(data) {
    document.getElementById("sensors-update-status").innerHTML = getStatusString(data);
    if(data.lastUpdated) {
      document.getElementById("sensors-update-timestamp").innerHTML = "Last updated " + getReadableTimeSince(data.lastUpdated);
    }
  })

  socket.on("status_totem", function(data) {
    // If null, do neither
    if(data.live == true) {
      document.getElementById("totem-status-dot-"+data.totem_key).className = "status live";
    } else if(data.live == false) {
      document.getElementById("totem-status-dot-"+data.totem_key).className = "status down";
    }

    document.getElementById("totem-timestamp-"+data.totem_key).innerHTML = "Last made contact " + getReadableTimeSince(data.lastContact);

    if(data.live != true) {
      document.getElementById("totem-current-page-"+data.totem_key).innerHTML = "Unknown ("+data.curPage+")";
    } else {
      document.getElementById("totem-current-page-"+data.totem_key).innerHTML = data.curPage;
    }


    document.getElementById("totem-last-interaction-"+data.totem_key).innerHTML = getReadableTimeSince(data.lastInteraction) + " <span style='color: #999'>("+data.interactions+" today)</span>";

    document.getElementById("totem-dropouts-"+data.totem_key).innerHTML = data.dropouts;

  });

  socket.on("day_logs", function(data) {
    buildLogTable(data);
  });

  socket.on("script_logs", function(data) {
    buildScriptLogTable(data);
  });
}

function createTotemTile(key, totem) {
  var container = document.createElement("div");
  container.className = "container";

  var headerRow = document.createElement("div");
  headerRow.className = "container_row container_title";

  var headerContainer = document.createElement("div")
  headerContainer.className = "container_header"

  var headerTitle = document.createElement("h2");
  headerTitle.innerHTML = "Totem " + totem.id + " - " + totem.name + " (" + key + ")"

  var headerTimestamp = document.createElement("p");
  headerTimestamp.className = "header_timestamp";
  headerTimestamp.innerHTML = "Connecting..."
  headerTimestamp.id = "totem-timestamp-"+key;

  headerContainer.appendChild(headerTitle);
  headerContainer.appendChild(headerTimestamp);

  var status = document.createElement("div");
  status.id = "totem-status-dot-"+key;
  status.className = "status";

  headerRow.appendChild(headerContainer);
  headerRow.appendChild(status);

  container.appendChild(headerRow);

  container.appendChild(createItemRow("Display URL", "totem-url-"+key, "<a href='"+totem.display_url+"'>"+totem.display_url+"</a>"));
  container.appendChild(createItemRow("Current Page", "totem-current-page-"+key, "", function(){ getDayLogs('logs_navigation_'+key, 'Navigation Logs ('+key+')')} ));
  container.appendChild(createItemRow("Last Interaction", "totem-last-interaction-"+key,"", function(){ getDayLogs('logs_interaction_'+key, 'Page Interactions ('+key+')')} ));
  container.appendChild(createItemRow("Dropouts Today", "totem-dropouts-"+key, "", function(){ getDayLogs('logs_status_'+key, 'Status Logs ('+key+')')} ));

  document.getElementById("page-wrapper").appendChild(container);
}

function createItemRow(item_name, value_id, value_content="", onclick=null) {
  var d = document.createElement("div");
  d.className = "container_row container_item";
  if(onclick) {
    d.onclick = onclick;
  }
  var item = document.createElement("h3");
  item.className = "item";
  item.innerHTML = item_name;
  var val = document.createElement("h3");
  val.className = "value";
  val.innerHTML = value_content;
  val.id = value_id;
  d.appendChild(item);
  d.appendChild(val);

  return d;
}

function getStatusString(data) {
  var statString = "";
  if(data.warnings > 0) {
    if(data.warnings == 1) { statString += '<span class="warn_text">'+data.warnings+' warning</span> - '; }
    else { statString += '<span class="warn_text">'+data.warnings+' warnings</span> - '; }
  }
  if(data.errors > 0) {
    if(data.errors == 1) { statString += '<span class="err_text">'+data.errors+' error</span> - '; }
    else { statString += '<span class="err_text">'+data.errors+' errors</span> - '; }
  }
  if(data.live) {
    statString += '<span class="live_text">Live</span>'
  } else {
    statString += '<span class="down_text">Down</span>'
  }

  return statString;
}

function getReadableTimeSince(ts) {

  if(ts == null) {
    return "[unknown]"
  }

  var ageMS = Date.now() - ts;

  // Check "just now" bounds; anywhere within the last 5 minutes
  if(ageMS < 60000) {
    return "just now";
  }

  // If we're within an hour, handle minutes
  if(ageMS < 3600000) {
    var t = Math.floor(ageMS / 60000)
    if(t == 1) {
      return t + " minute ago";
    } else {
      return t + " minutes ago";
    }
  }

  // Else, hours
  if(ageMS < 7200000) {
    return "an hour ago";
  }

  // NOTE: Data older than 24 hours should be handled separately
  var time = new Date(ts);
  var hr = time.getHours();
  var min = time.getMinutes();
  var sec = time.getSeconds();
  var dt = time.getDate();
  var mon = time.getMonth()+1;

  var tString = "at "
  tString += (hr < 10 ? "0"+hr : hr) + ":";
  tString += (min < 10 ? "0"+min : min) + ":";
  tString += (sec < 10 ? "0"+sec : sec) + " on ";
  tString += (dt < 10 ? "0"+dt : dt) + "/";
  tString += (mon < 10 ? "0"+mon : mon);

  return tString;
}

function getReadableTime(ts) {
  if(ts == null) {
    return "[unknown]"
  }

  // NOTE: Data older than 24 hours should be handled separately
  var time = new Date(ts);
  var hr = time.getHours();
  var min = time.getMinutes();
  var sec = time.getSeconds();
  var dt = time.getDate();
  var mon = time.getMonth()+1;

  var tString = "";
  tString += (hr < 10 ? "0"+hr : hr) + ":";
  tString += (min < 10 ? "0"+min : min) + ":";
    tString += (sec < 10 ? "0"+sec : sec) + " on ";
  tString += (dt < 10 ? "0"+dt : dt) + "/";
  tString += (mon < 10 ? "0"+mon : mon);

  return tString;
}

////////////////////////////////////////////////////////////////////////////////

// Check for stored login

// Request socket to server; send login details if we have them

// On content response, build page - log out if server rejects

// Functions to update statuses

makeConnection();

//// LOG OVERLAY ///////////////////////////////////////////////////////////////

// Get a full log (e.g. totem status) and display all contents

function getDayLogs(collection, title) {
  socket.emit("request_day_logs", collection);
  resetOverlay(title);
}

// Get logs for the script execution (warnings and errors)
function getScriptLogs(collection, title) {
  // Open the overlay and attempt to get the logs
  socket.emit("request_script_logs", collection);
  resetOverlay(title);
}

function resetOverlay(title) {
  var container = document.getElementById("overlay-table-container")
  while(container.firstChild) {
    container.removeChild(container.firstChild);
  }
  container.innerHTML = "<h3 class='overlay'>Loading...</h3>"

  document.getElementById("overlay-title").innerHTML = title;
  document.getElementById("overlay").style.display = "block";
}

function resetLogTable() {
  var container = document.getElementById("overlay-table-container")
  while(container.firstChild) {
    container.removeChild(container.firstChild);
  }

  var table = document.createElement("table");
  table.onclick = 'event.stopPropagation();event.preventDefault();';
  table.appendChild(createTableRow("Time", "Messages", "th"));

  container.appendChild(table);

  return table;
}

function buildLogTable(data) {
  var table = resetLogTable();
  for(var i = data.length-1; i >= 0; i--) {
    table.appendChild(createTableRow(getReadableTime(data[i].timestamp), getFormattedLog(data[i]), "td"));
  }
}

function buildScriptLogTable(data) {
  var table = resetLogTable();
  for(var i = data.length-1; i >= 0; i--) {
    table.appendChild(createTableRow(getReadableTime(data[i].timestamp), getFormattedScriptLog(data[i]), "td"));
  }
  // For each item, set up table of timestamp, warnings and errors
}

function createTableRow(col1, col2, type) {
  var tr = document.createElement("tr");
  var c1 = document.createElement(type);
  c1.innerHTML = col1;
  var c2 = document.createElement(type);
  c2.innerHTML = col2;
  tr.appendChild(c1);
  tr.appendChild(c2);
  return tr;
}

// Basic format of a log into something more readable
function getFormattedLog(data) {
  var m = "<span style='font-family:Courier New, monospaced'>";
  for(k in data) {
    if(k == "_id" || k == "timestamp") { continue; }
    m += "<span style='color:#888'>"+k + ":</span> " + data[k] + "<br>";
  }
  m += "</span>";
  return m;
}

function getFormattedScriptLog(data) {
  var m = "";
  if(data.warnings) {
    m += "<span class='warn_text'>Warnings:</span><br>";

    m += data.warnings.join("<br>");
  }
  if(data.errors) {
    if(data.warnings) {
      m += "<br><br>";
    }
    m += "<span class='err_text'>Errors:</span><br>"
    m += data.errors.join("<br>");
  }

  return m;
}

function closeOverlay() {
  document.getElementById("overlay").style.display = "none";
}
