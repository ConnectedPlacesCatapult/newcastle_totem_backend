var bcrypt = require('bcrypt');
const saltRounds = 10;

var plaintext = process.argv[2];
console.log("Hashing " + plaintext);

bcrypt.hash(plaintext, saltRounds, function(err, hash) {
  if(err) { console.log(err); }
  else { console.log(hash); }
});
