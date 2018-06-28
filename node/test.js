const express = require('express')
const app = express()
const bodyParser = require('body-parser')

const MongoClient = require('mongodb').MongoClient;
const assert = require('assert');

const mongoURL = 'mongodb://localhost:27017';
const mongoName = 'totem_backend';

function mongoExec(method, collection, data) {
  MongoClient.connect(mongoURL, function(err, client) {

    assert.equal(null, err);
    console.log("Connected to Mongo server")
    const db = client.db(mongoName)

    method(db, collection, data, function() {
      client.close()
    });

  });
}

function mongoInsertOne(db, collection, data, callback) {
  const col = db.collection(collection);
  col.insert(data, function(err, res) {
    assert.equal(err, null);
    console.log("Successfully inserted");
    callback(res);
  });
}


//// ANALYTICS CALLS

app.use( bodyParser.json() );
app.use( bodyParser.urlencoded({ extended: true }));

app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

app.post('/analytics', function(req, res) {
  console.log("Got a post");
  console.log(req.body);
  var totem_id = req.body.id;
  var test = req.body.test;

  res.send(totem_id + ", " + test);
});

// Testing
// app.get('/', (req, res) => res.send('Hello Remote!'))

app.listen(3000, () => console.log('Listening on port 3000'))
