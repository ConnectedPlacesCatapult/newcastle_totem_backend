/*
    Should run on every page to log totem usage

    Relies on the totem_key, curPage, and curSubPage being passed somewhere
    in the page - possibly parsed from URL or hard-coded
*/

// Event listeners for interactions
document.addEventListener("click", function(e) { handleInteraction(e) });
document.addEventListener("touchstart", function(e) { handleInteraction(e) });
document.addEventListener("keypress", function(e) { handleKeyPress(e) });


console.log(window.innerWidth);
console.log(window);

// Heartbeat interval set as 5 minutes
const heartbeatInterval = 300000;
const controllerEndpoint = "http://localhost:3000";

//// HANDLE INTERACTION LOGGING ////////////////////////////////////////////////

// Unpack any stored log or start fresh
var log = {};

// If a log exists, parse it and attempt to push to the backend
if(localStorage.getItem("log")) {
  log = JSON.parse(localStorage.getItem("log"));
} else {
  // No existing log - create new
  log = resetLog();
}

// Add navigation to this current page
log.navigation.push({
  timestamp: Date.now(),
  page: curPage,
  subpage: curSubPage,
  from_page: localStorage.getItem("last_page"),
  trigger: localStorage.getItem("nav_trigger")
});

// Pre-emptively reset nav_trigger to "auto"
localStorage.setItem("nav_trigger", "auto");
// Update 'last page' to this current page, to be used on next pageload
localStorage.setItem("last_page", curPage + (curSubPage == null ? "" : "_" + curSubPage));

function resetLog() {
  return {
    navigation: [],
    interaction: []
  }
}

//// Heartbeat/totem update handling

// Initially attempt to push the log immediately
sendUpdate();

function sendUpdate() {
  console.log("Attemptng to send update");
  $.post( controllerEndpoint, log, function(res) {
      // Successfully pushed; clear the log
      if("success" in res) {
        log = resetLog();
        localStorage.removeItem("log");
      } else {
        // TODO handle
        console.log(res);
      }

      // Handle any updates returned from the mainframe?
      if("updates" in res) {
        // TODO
      }

    })
    .fail(function(err) {
      // TODO Some form of error handling
      console.log(err)
    })
    .always(function() {
      // Set heartbeat again
      setTimeout(function(){ sendUpdate() }, heartbeatInterval)
    });
}

//// Interaction handlers

// Handles any click or touch interactions
function handleInteraction(e) {
  var el = e.toElement;

  // If the clicked element has an href, don't follow - but store the log
  if(el.href !== undefined) {
    localStorage.setItem("nav_trigger", "touch")
    localStorage.setItem("log", JSON.stringify(log));
  } else {
    var logInt = {
      timestamp: Date.now(),
      page: curPage,
      subpage: curSubPage,
      trigger: "touch",
      element_id: el.id,
      x: e.clientX,
      y: e.clientY
    }

    // Set null element ID if none
    if(el.id === "") {
      logInt.element_id = null;
    }

    log.interaction.push(logInt);
  }
}

// Translates button presses into navigation
function handleKeyPress(e) {
  switch(e.keyCode) {
    case 49: // 1
      buttonPress("/");
      break;
    case 50: // 2
      buttonPress("/ili/");
      break;
    case 51: // 3
      buttonPress("/urban-observatory/");
      break;
    case 52: // 4
      buttonPress("/partner/");
      break;
    default:
      break;
  }
}

function buttonPress(target) {
  localStorage.setItem("nav_trigger", "button");
  window.location.href = target;
}
