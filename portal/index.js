// HANDLES ALL CONNECTION TO MAINFRAME
var socket;
const addr = "http://52.56.231.86:3001"

function makeConnection() {
  socket = io(addr);

  socket.io.on('connect_error', function(e) {
    // Server is down!
    document.getElementById("server-timestamp").innerHTML = "Could not connect";

    socket.disconnect();
  });

  socket.on('init_content', function(data) {
    console.log("Got initial data");
    console.log(data);

    // Set server status
    var liveSince = new Date(data.mainframe.liveSince);
    var hr = liveSince.getHours();
    var min = liveSince.getMinutes();
    var dt = liveSince.getDate();
    var mon = liveSince.getMonth()+1;

    var tString = "Live since ";
    tString += (hr < 10 ? "0"+hr : hr) + ":";
    tString += (min < 10 ? "0"+min : min) + " on ";
    tString += (dt < 10 ? "0"+dt : dt) + "/";
    tString += (mon < 10 ? "0"+mon : mon);
    document.getElementById("server-timestamp").innerHTML = tString;
  });

  socket.on("status_ili_source", function(data) {
    console.log("ili source");
    console.log(data);
  })

  socket.on("status_ili_clean", function(data) {
    console.log("ili clean");
    console.log(data);
  })

  socket.on("status_ili_update", function(data) {
    console.log("ili update");
    console.log(data);
  })

  socket.on("status_sensors_source", function(data) {
    console.log("sensors source");
    console.log(data);
  })

  socket.on("status_sensors_update", function(data) {
    console.log("sensors update");
    console.log(data);
  })

  socket.on("status_totem", function(data) {
    console.log("status totem");
    console.log(data);
  })

}


// Check for stored login

// Request socket to server; send login details if we have them

// On content response, build page - log out if server rejects

// Functions to update statuses

makeConnection();
