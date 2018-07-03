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
    document.getElementById("server-timestamp").innerHTML = "Last restarted " + getReadableTime(data.liveSince);

    totems = data.totems;
    // Set up totems DOM
    for(t_key in totems) {
      createTotemTile(t_key, totems[t_key]);
    }

  });

  socket.on("status_ili_source", function(data) {
    document.getElementById("ili-source-status").innerHTML = getStatusString(data);
    if(data.lastUpdated) {
      document.getElementById("ili-source-timestamp").innerHTML = "Last updated " + getReadableTime(data.lastUpdated);
    }
  })

  socket.on("status_ili_clean", function(data) {
    document.getElementById("ili-clean-status").innerHTML = getStatusString(data);
    if(data.lastUpdated) {
      document.getElementById("ili-clean-timestamp").innerHTML = "Last updated " + getReadableTime(data.lastUpdated);
    }
  })

  socket.on("status_ili_update", function(data) {
    document.getElementById("ili-update-status").innerHTML = getStatusString(data);
    if(data.lastUpdated) {
      document.getElementById("ili-update-timestamp").innerHTML = "Last updated " + getReadableTime(data.lastUpdated);
    }
  })

  socket.on("status_sensors_source", function(data) {
    document.getElementById("sensors-source-status").innerHTML = getStatusString(data);
    if(data.lastUpdated) {
      document.getElementById("sensors-source-timestamp").innerHTML = "Last updated " + getReadableTime(data.lastUpdated);
    }
  })

  socket.on("status_sensors_update", function(data) {
    document.getElementById("sensors-update-status").innerHTML = getStatusString(data);
    if(data.lastUpdated) {
      document.getElementById("sensors-update-timestamp").innerHTML = "Last updated " + getReadableTime(data.lastUpdated);
    }
  })

  socket.on("status_totem", function(data) {
    // If null, do neither
    if(data.live == true) {
      document.getElementById("totem-status-dot-"+data.totem_key).className = "status live";
    } else if(data.live == false) {
      document.getElementById("totem-status-dot-"+data.totem_key).className = "status down";
    }

    document.getElementById("totem-timestamp-"+data.totem_key).innerHTML = "Last made contact " + getReadableTime(data.lastUpdated);

    document.getElementById("totem-current-page-"+data.totem_key).innerHTML = data.curPage;

    document.getElementById("totem-last-interaction-"+data.totem_key).innerHTML = getReadableTime(data.lastInteraction) + " ("+data.interactions+" today)";

    document.getElementById("totem-dropouts-"+data.totem_key).innerHTML = data.dropouts;

  })
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
  container.appendChild(createItemRow("Current Page", "totem-current-page-"+key));
  container.appendChild(createItemRow("Last Interaction", "totem-last-interaction-"+key));
  container.appendChild(createItemRow("Dropouts Today", "totem-dropouts-"+key));

  document.getElementById("page-wrapper").appendChild(container);
}

function createItemRow(item_name, value_id, value_content="") {
  var d = document.createElement("div");
  d.className = "container_row container_item";
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

function getReadableTime(ts) {

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
  var dt = time.getDate();
  var mon = time.getMonth()+1;

  var tString = "at "
  tString += (hr < 10 ? "0"+hr : hr) + ":";
  tString += (min < 10 ? "0"+min : min) + " on ";
  tString += (dt < 10 ? "0"+dt : dt) + "/";
  tString += (mon < 10 ? "0"+mon : mon);

  return tString;
}

// Check for stored login

// Request socket to server; send login details if we have them

// On content response, build page - log out if server rejects

// Functions to update statuses

makeConnection();
