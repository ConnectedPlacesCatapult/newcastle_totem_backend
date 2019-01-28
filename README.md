# Tech Totem Software Infrastructure
This repo holds all backend code for Newcastle Tech Totem softaware infrastructure. For details on the front end wordpress installation please visit https://github.com/FutureCitiesCatapult/newcastle_totem_wordpress

## Table of Contents

## Quick links & details
The backend is hosted on an EC2 instance:
ubuntu@ec2-35-176-15-249.eu-west-2.compute.amazonaws.com

The mainframe dashboard can be found here: http://35.176.15.249:8080/ 

The wordpress page is live at http://35.176.15.249/


## Wordpress distribution on EC2
After SSH-ing in the instance, the WordPress distribution is located at:

```bash

 /home/ubuntu/wp/wordpress
```

This folder contains all wordpress multisite code used for all totems. The frontend template files are located at:

```bash

/home/ubuntu/wp/wordpress/wp-content/themes/techtotem/template-parts/acf-components
```


This folder contains most of the frontend code. For example, the map of ‘Show me the way to’ is located at content-locale-map.php. Note that any change made in those templates will be reflected throughout the cloned sites. 

The WordPress domain is http://35.176.15.249/. Here, 3 sites are hosted:

The Master Template http://35.176.15.249/
A site used for testing http://35.176.15.249/test (clone)
The Science Helix site http://35.176.15.249/helix (clone)

The cloned sites have exactly the same structure as the master template with two major differences: The data used (ILI and sensor data) used are different (refer to 3. Runs the ILI code for more details) and the partner page. The later can be changed manually by writing php, html or js code directly from the WordPress dashboard. 

You can login to the WordPress dashboard that controls the sites at http://35.176.15.249/wp-admin

For more details on how to use the dashboard to clone the master template refer to: https://www.useloom.com/share/f0fab779a3b24e88b8ab9524555a59e7


## The Totem Mainframe Server
This is where the monitoring framework is hosted. On EC2 this is located at 

```bash

/home/ubuntu/newcastle_totem_backend 
```

The core component is the ‘mainframe server’, which runs in Node.JS, located here:

```bash

/home/ubuntu/newcastle_totem_backend/node/mainframe.js
```

This server runs continuously (using the ‘forever’ module) and handles the following tasks:

Triggering and monitoring the scripts for sourcing and uploading the ILI and urban observatory sensor data to the “newcastle.tech.totem” bucket in S3
Status monitoring and analytics for the totems themselves - both in terms of liveness (expecting regular contact from the totems and making an alert if they are silent for a certain period), and interaction (page navigations, touchscreen events, and button presses)
Providing status data and administrative tools through a web-hosted management dashboard, hosted at: http://35.176.15.249:8080 -- Currently set with hard-coded passwords - check with Gulliver or Thanos for access

Settings and configuration details such as update intervals can be modified using mainframe_config.json, also found in the node folder.

Note that the server also uses a local MongoDB instance (database name: totem_backend) for storing logs and totem analytics data.

### Running the mainframe

The mainframe is set to run automatically on boot in the sudo crontab:

```bash

@reboot /usr/local/bin/forever start /home/ubuntu/newcastle_totem_backend/node/mainframe.js
```

The server process should appear listed in response to:

```bash

sudo forever list
```

E.g.

```bash

info:    Forever processes running
data:        uid  command             script       forever pid  id logfile                        uptime
data:    [0] 1ajx /usr/local/bin/node mainframe.js 7513    7519    /home/ubuntu/.forever/1ajx.log 0:6:18:1.166
```

It can be started by navigating to 

```bash

~/newcastle_totem_backend/node/
```

and running

```bash

sudo forever start mainframe.js
```

This will cause an immediate update for the ILI and Sensor data, though will not perform a content sourcing call (i.e. requesting an updated set of local events, descriptive ILI content, and descriptive sensor content) by default. The content sourcing scripts are set to run daily, and rely on a number of third-party APIs whose quotas can be easily exhausted. However, you can add an “init” parameter to force a full refresh of content when starting the server - just take care not to over-do it! Additionally, a “debug” parameter will print all output to the console. When debugging, you might want to stop the forever service and run the mainframe in the terminal:

```bash

sudo node mainframe.js init debug
```

The forever service can be terminated using:

```bash

sudo forever stop [uid]     
```

e.g.   '''sudo forever stop 0'''

Mainframe status logs are stored in 

```bash

~/newcastle_totem_backend/node/logs
```


NOTE: MongoDB requires a certain amount of space to run; if the mainframe can’t be started, there may be a lack of space preventing it from initialising Mongo. Ensure that /etc/mongodb.conf contains ‘smallfiles=true’ and ‘journal=false’, or clear space on the drive.

### Content Scripts
The dashboard acts a control board for monitoring the health of ILI & sensors scripts. These are scripts written in python which upload the dynamic totem content to the newcastle.tech.totem S3 bucket, used by the frontend when building its pages.


#### ILI Sourcing
Should run daily, in the morning - initially set to 8am
Sources daily data such as events and points of interest
Location: 

```bash
newcastle_totem_backend/ili/data_sourcing.py
```
#### ILI Cleaning
Should run following successful execution of ILI Sourcing
Organises results of the ILI Sourcing code into places_all.json
Location: 

```bash
newcastle_totem_backend/ili/data_cleaning.py
```
#### ILI Update
Should run regularly throughout the day - set hourly at time of writing
Synthesises content 
Location: 
```bash
newcastle_totem_backend/ili/data_call.py
```
#### Sensor Sourcing
Should run daily, in the morning - initially set to 8am
Sources written content for the sensors from Google Sheets (e.g. descriptions and taglines)
Location: 

```bash
newcastle_totem_backend/sensors/fetch_content.py

```
#### Sensor Update
Should run regularly throughout the day - initially set to quarter-hourly
Requests latest sensor readings from urban observatory
Location: '''newcastle_totem_backend/sensors/update_sensors.py'''

Each script is attempted 3 times and errors/warnings are logged in a local mongoDB instance, in the following tables:
```bash

logs_ili_clean
logs_ili_source
logs_ili_update
logs_sensors_source
logs_sensors_update
```

Daily logs from these tables can be found on the mainframe dashboard page by clicking the row for the desired script.

### Totem analytics


The mainframe provides an /analytics endpoint, to which totem data is sent via HTTP POST. The totems are configured to send an update to /analytics at a regular interval (5 minutes at time of writing). The body pushed has the following format:

```bash

{
  totemKey: [totem key],          // Required - Should match the wordpress subdirectory, e.g. ‘helix’
  navigation: [                   // Optional - array of navigation logs
    {
      timestamp                   // Milliseconds
      page                        // Page name, e.g. /urban-observatory
      subpage                     // Subpage, if exists, e.g. ?sensor=co
      trigger                     // Navigation trigger - one of [button, auto, touch]
      from_page                   // Should equal ‘page’ value for previous navigation
    },
    ...                           // Should be listed in chronological order
  ],
  interaction: [                  // Optional - array of interaction logs
    {
      timestamp                   // Milliseconds
      page                        // As above
      subpage                     // As above
      trigger                     // As above
      element_id                  // ID of the DOM element pressed, if exists
      x                           // Horizontal coordinate of touch, if exists
      y                           // Vertical coordinate of touch, if exists
    },
    ...
  ]
}
```

As a minimum, the body should contain ‘totemKey’, which will reset a heartbeat timer within the mainframe server. If this heartbeat timer expires, an alert should be raised that the totem has not sent an update within the specified time period.

The ‘navigation’ and ‘interaction’ arrays should simply be pushed to their respective tables in the mongodb:

```bash

logs_navigation_[totem key]
logs_interaction_[totem key]
```

### Totem Configuration
Totem details are stored in newcastle_totem_backend/totem_details.json. This file is used by both the python scripts and the mainframe. Any totem settings, such as which URL to display and how frequently to send updates, should be configured here; the mainframe will communicate these to the totem controllers as needed. The totem mainframe dashboard offers controls for making these changes; this is the recommended process for making changes. Do not modify totem_details.json whilst the mainframe is running - it may overwrite the file with its own copy should it receive any updates. If you want to change hard-coded details, stop the mainframe first.

Here’s a breakdown of a totem object:

```bash

"helix": {
    "id": "5",
    "active": true,
    "name": "Helix",
    "lat": 54.972352,
    "lon": -1.622857,
    "sensorSources": {
      "local": {},
      "remote": {
        "new_new_emote_2601": [
          "CO",
          "NO2",
          "Sound"
        ],
        "eml_sensors3_164118": [
          "Wind Direction"
        ],
        "aq_mesh1918150": [
          "PM10",
          "O3"
        ],
        "King%20Gate%20Weather": [
          "Solar Radiation"
        ]
      }
    },
    "controllerConfig": {
      "displayURL": "http://35.176.15.249/helix",
      "buttonElements": {
        "default": [
          "nav_1",
          "nav_2",
          "nav_3",
          "nav_4"
        ]
      }
    },
    "status": {
      "live": true,
      "lastContact": 1538060168851,
      "curPage": "helix",
      "lastInteraction": 1538060168709
    }
  }
```


### Mainframe Dashboard
Files for the dashboard are stored in the ‘portal’ file of the git repo. These are static HTML files which use socket.io to communicate with the mainframe server. On initialisation, it requests all current status data - since 6am that day - and then maintains live updates.

The mainframe status is listed first, displaying the status of the server and for each of the 5 content scripts. Clicking on one of the content script rows will open the warning and error logs for that day.

Totems are listed below, with their status and selected statistics shown by default. Clicking on these rows will open any options for that field.

## The ILI code
On EC2 this is located at 

```bash

/home/ubuntu/newcastle_totem_backend/ili
```

The ILI code is in charge of generating the recommendation data content for the WordPress sites. The output of the process is uploaded on S3 at 

```bash

https://s3.console.aws.amazon.com/s3/buckets/newcastle.tech.totem
```

The name of the file is recommendation-totem-xx.json where xx is the id of the WordPress site.

The ILI code is made of three scripts:

```bash
data_sourcing.py
```
This script sources the foursquare, eventbrite and meetup events. It is run daily.

```bash
data_cleaning.py
```

This script cleans the data (both from data_sourcing.py as well as static data) and outputs the 

```bash
places_all.json
```

file. This is run daily.

```bash
data_call.py
```

This filters the data according to different parameters and outputs the file recommendation-totem-xx.json. It also uploads this to S3. A think to note, is that this script uses this google sheet (https://docs.google.com/spreadsheets/d/1T-_8KdB-I2jCls2wVhJ9mNAlT4y287lpNNLEBFQ1I9Y/edit#gid=0) to generate a welcome phrase for the recommendation. This is referred to as action_msg in the code. The script runs every 15 minutes.

## The Sensors Code

On the EC2, sensor scripts are located at

```bash

/home/ubuntu/newcastle_totem_backend/sensors
```

```bash
Update_sensors.py
```

is responsible for querying the Urban Observatory API for new sensor data. It uses the shared totem_details.json file as a configuration file, and, for each listed totem, will request readings from the sensor IDs specified in that file. The output of the process is uploaded on S3 at :

```bash

https://s3.console.aws.amazon.com/s3/buckets/newcastle.tech.totem
```

```bash
fetch_content.py
```

should run daily to update the sensor metacontent - including the textual descriptions of each sensor variable to be displayed on the WordPress page, along with any taglines. This metacontent is sourced from a Google Sheets file located here:

```bash
https://docs.google.com/spreadsheets/d/14juakEmoRi9Mu4XFGr7Wx8QvGOaLxhR1ZavP2crOpV0/edit#gid=368120426
```

Note that the format of this file must be strictly maintained so as to match what the fetch_content script expects. The output of this script is the '''sensor_details.json''' file, which wil be used in lieu of a successful fetch. 

### Specifying which sensors to use
Each totem listed in totem_details.json should include a ‘sensorSources’ definition - for example:

```bash

    "sensorSources": {
      "local": {},
      "remote": {
        "new_new_emote_2601": [
          "CO",
          "NO2",
          "Sound"
        ],
        "eml_sensors3_164118": [
          "Wind Direction"
        ],
        "aq_mesh1918150": [
          "PM10",
          "O3"
        ],
        "King%20Gate%20Weather": [
          "Solar Radiation"
        ]
      }
    },
```

This contains two principle objects:

    local - contains the IDs for sensors inside the totem. Readings taken from these sensors will be labeled as “Data from sensors inside this totem” on the WordPress web page.

    remote - contains the IDs for any other sensors, and will be labeled as “Data taken from sensors distributed throughout Newcastle”

The contents of these objects should follow this format:

```bash

  <sensor_id>: [
    <variable-name>,
    …
  ],
  …
```
  
sensor_id should match the exact ID of a sensor in the Urban Observatory database. The update_sensors script will construct a query to request this sensor’s readings.

variable-name should be one of:

* CO
* NO2
* Sound
* Wind DIrection
* PM10
* O3
* Solar Radiation

Each of those variables should be assigned to a source for each totem - as you can see above, the Helix totem uses sensor ‘aq_mesh1918150’ for both PM10 and O3 data. These keys must be exact; this is how they appear in the Urban Observatory API. 

Changing the sensors being used is a simple case of adding a new entry to either local or remote, using a valid sensor ID, and ensuring there are no duplicated variables after adding it.

### Choosing sensor sources
At time of writing, the lists chosen were manually selected by manually running the API, choosing appropriate sensors based on their update frequency and proximity. An alternative to this approach to naming specific sensors is to use ‘other’, which will trigger instead make a query by distance and take the nearest reading. This may not be the optimum reading, however, so should not generally be used - it may be an old reading or from an unreliable sensor, for instance.

Use ‘other’ just as you would a normal sensor, e.g. if you have specific sensors for most variables but have no preference for the CO and O3 variables, you might add:

```bash
    ...
    “other”: [
          “CO”,
        “O3”,
    ],
    …
```

This should go in the ‘remote’ object.

## The Totem Controller

Each totem contains a PC running a light version of Windows 7. This PC runs a nodeJS server called the ‘totem controller’, which performs the following tasks:

* Maintaining the totem configuration settings, including heartbeat intervals and display URL
* Receiving




