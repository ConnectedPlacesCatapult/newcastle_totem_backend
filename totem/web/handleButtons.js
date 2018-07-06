// Simply sets up an event listener for the buttons, mapping them directly to
// the navigation footer

document.addEventListener("keypress", function(e) {
  switch(e.keyCode) {
    case 49: // 1
      buttonPress(1, "/");
      break;
    case 50: // 2
      buttonPress(2, "/ili/");
      break;
    case 51: // 3
      buttonPress(3, "/urban-observatory/");
      break;
    case 52: // 4
      buttonPress(4, "/partner/");
      break;
    default:
      break;
  }
});

function buttonPress(button, target) {
  localStorage.setItem("nav_trigger", "button");
  window.location.href = target;
}
