#### Requests updates from Urban Observatory sensors and uploads to S3

## OUTPUT FORMAT
# {
#   [var name]: {
#     description:
#     label:
#     local:
#     name:
#     reading:
#     source:
#     tagline:
#     timestamp:
#     units:
#   },
#   ...
# }

import requests
import random
import json
import math
import os
from datetime import datetime
import random
import time
import boto3
from botocore.client import Config

# LOAD KEY DETAILS
with open('../keys.json') as keys:
    keys = json.load(keys)

### NEWCASTLE API ACCESS
API_KEY = keys["uo_api_key"]
API_BASE = "http://uoweb1.ncl.ac.uk/api/v1/"
API_KEY_PARAM = "api_key=" + API_KEY

### S3 ACCESS
ACCESS_KEY_ID = keys["boto3_access_key"]
ACCESS_SECRET_KEY = keys["boto3_secret_access_key"]
BUCKET_NAME = keys["bucket_name"]

### DATA AGGREGATION VARS, used when no specific sensor is given
AGG_METHOD = "nearest" # one of "nearest", "latest", or "average"
AGG_RADIUS = 2000

### SOURCE TEXT, displayed below sensor readings
SOURCE_REMOTE = "Urban Observatory sensors distributed throughout Newcastle"
SOURCE_LOCAL = "Urban Observatory sensors inside this totem"

### LOAD SENSOR DETAILS
with open('sensor_details.json') as sensor_details:
    SENSOR_DETAILS = json.load(sensor_details)

#### LOAD TOTEM DETAILS

# Note: If no specific sensors are used, add an "other" entry in the
# "remote" object in totem_details.json, listing all unaddressed vars
# e.g.
#
# "remote: {
#   "other": [
#     "CO",
#     "O2",
#     "Humidity"
#   ]
# }

with open('../totem_details.json') as totem_details:
    totems = json.load(totem_details)

################################################################################
#### FUNCTIONS

#
# Parse a reading to return int or rounded float
#
def parse_reading(reading):
    if math.floor(reading) == reading:
        # If we have an int value, use int
        return int(reading)
    else:
        # Else, round to 2dp
        return "%.2f" % reading

#
# Given date in NCL API format, return millisecond UTC timestamp
#
def get_ms_timestamp(date):
    return int(time.mktime(datetime.strptime(date, "%Y-%m-%d %H:%M:%S").timetuple()) * 1000)

#
# Given some string units from NCL, translate to HTML-friendly representation
#
def translate_units(raw_units):

    translated = raw_units

    ### Expected units:
    # ppb
    # ugm-3
    # %
    # Bearing
    # W/m2
    # db - dB
    ###

    # Micrograms
    if raw_units == "ugm -3":
        return "&#181g/m<sup>3</sup>"
    elif raw_units == "db":
        return "dB"
    elif raw_units == "Bearing":
        return "&#176" # degree symbol
    elif raw_units == "W/m2":
        return "W/m<sup>2</sup>"
    else:
        # If all else fails, return raw
        return raw_units

#
# Squared distance between two points (arrays of x, y)
#
def get_squared_distance(p1, p2):
    return (p2[0] - p1[0])*(p2[0] - p1[0]) + (p2[1] - p1[1])*(p2[1] - p1[1])

################################################################################

#### MAIN

current_time = int(time.time()*1000);

# For every totem, update sensors
for totem_id, totem in enumerate(totems, start=1):

    # Load previous totem data, if it exists
    totem_data = {}

    try:
        with open("sensors-totem-"+str(totem_id)+".json") as totem_data:
            totem_data = json.load(totem_data)
    except EnvironmentError:
        print "Exception when opening sensors-totem-"+str(totem_id)+".json"
        # TODO - raise alert with mainframe

    # For each variable, retrieve data
    for locality, sources in totem["sensor_sources"].iteritems():
        for source, vars in sources.iteritems():

            # Source is other - make a request over an area for these vars
            if source == "other" and len(vars) > 0:

                #### Construct call and request data

                # Form -and- delimited param string for API call
                params = "-and-".join(vars);
                # Add %20 in lieu of spaces for request
                params = params.replace(' ', "%20");
                # Prepare the geographic buffer - NOTE LON comes before LAT!
                buffer = str(totem["lon"]) + "," + str(totem["lat"]) + "," + str(AGG_RADIUS)

                # Make the call to get all sensors matching these params
                req = requests.get(
                    API_BASE + "sensors/live.json?" + API_KEY_PARAM +
                    "&variable=" + params +
                    "&buffer=" + buffer
                )

                all_sensors = req.json()

                #### Prepare object for storing readings for each "other" variable

                readings_nearest = {}
                readings_average = {}
                readings_latest = {}

                # Prepare objs for each method - TODO only really need one
                for v in vars:
                    readings_nearest[v] = {
                      "min_dist": -1,
                      "reading": 0,
                      "timestamp": -1,
                      "units": ""
                    }

                    readings_average[v] = {
                      "sum": 0,
                      "count": 0,
                      "timestamp": -1, # Use most recent timestamp for average
                      "units": ""
                    }

                    readings_latest[v] = {
                      "reading": 0,
                      "timestamp": -1,
                      "units": ""
                    }

                # Loop through dataset once, check each sensor for vars of interest
                for s in all_sensors:

                    try:
                        # Disregard inactive sensors
                        if s["active"] is False:
                            continue

                        # Get basic dist from totem
                        # NOTE: NCL API returns "lon" ahead of "lat"
                        s_dist = get_squared_distance( [totem["lon"], totem["lat"]], s["geom"]["coordinates"] )

                        # Get timestamp "latest" for this sensor
                        s_timestamp = get_ms_timestamp(s["latest"])

                        # For each sensor, run through all variables and data
                        for s_v, s_d  in s["data"].iteritems():

                            # If this sensor variable is of interest, analyse
                            if s_v in vars:

                                # Get reading and units for this variable
                                s_reading = parse_reading(s_d["data"].items()[0][1])

                                # Sanity check reading to avoid clearly erroneous values
                                if s_reading < 0:
                                    continue

                                s_units = s_d["meta"]["units"]

                                # Update nearest reading
                                # NOTE it has to be within the last 12 hours! (720000 ms)

                                if (s_dist < readings_nearest[s_v]["min_dist"] and current_time - s_timestamp < 720000) or readings_nearest[s_v]["min_dist"] < 0:
                                    # This is the new nearest result; save data
                                    readings_nearest[s_v]["min_dist"] = s_dist
                                    # Assume one reading per variable
                                    readings_nearest[s_v]["reading"] = s_reading
                                    readings_nearest[s_v]["timestamp"] = s_timestamp
                                    readings_nearest[s_v]["units"] = s_units

                                # Update average reading
                                # NOTE Weak check for consistent unit may be inappropriate
                                if s_units == readings_average[s_v]["units"] or readings_average[s_v]["units"] == "":

                                    readings_average[s_v]["sum"] += s_d["data"].items()[0][1]
                                    readings_average[s_v]["count"] += 1

                                    # Use latest timestamp for the average's reported "time"
                                    if s_timestamp > readings_average[s_v]["timestamp"]:
                                        readings_average[s_v]["timestamp"] = s_timestamp

                                    # A bit sloppy but avoids a few issues...
                                    if readings_average[s_v]["units"] == "":
                                        readings_average[s_v]["units"] = s_units

                                # Update latest reading
                                if s_timestamp > readings_latest[s_v]["timestamp"]:
                                    readings_latest[s_v]["timestamp"] = s_timestamp
                                    readings_latest[s_v]["reading"] = s_reading
                                    readings_latest[s_v]["units"] = s_units

                    except Exception as e:
                        # TODO: Handle appropriately - log error with Mainframe
                        print "Error handling area request"
                        print e
                        continue

                #### Construct the output objects for these vars

                for v in vars:

                    # Get the static details for this variable
                    v_details = SENSOR_DETAILS[v]

                    var_out = {
                      "name": "data-" + v_details["key"],
                      "label": v_details["label"],
                      "tagline": random.choice(v_details["taglines"]),
                      "description": v_details["description"],
                      "local": False,
                      "source": SOURCE_REMOTE
                    }

                    if AGG_METHOD == "average":
                        var_out["reading"] = parse_reading(readings_average[v]["sum"]/readings_average[v]["count"])
                        var_out["timestamp"] = readings_average[v]["timestamp"]
                        var_out["units"] = translate_units(readings_average[v]["units"])
                    elif AGG_METHOD == "latest":
                        var_out["reading"] = readings_latest[v]["reading"]
                        var_out["timestamp"] = readings_latest[v]["timestamp"]
                        var_out["units"] = translate_units(readings_latest[v]["units"])
                    else: # default is "nearest"
                        var_out["reading"] = readings_nearest[v]["reading"]
                        var_out["timestamp"] = readings_nearest[v]["timestamp"]
                        var_out["units"] = translate_units(readings_nearest[v]["units"])

                    # ONLY APPLY IF THESE VALUES ARE VALID
                    # Else, skip and use existing values
                    if var_out["timestamp"] < 0:
                        # TODO Communicate issue to Mainframe to missing value
                        print "MISSING VARIABLE " + v
                        continue

                    # Insert this variable data into totem data obj
                    totem_data[v_details["key"]] = var_out

            else:

                #### Request live readings for the specified sensor
                print "Attempting to request from sensor " + source + "..."
                try:
                    # Make a request for this source
                    # No auth necessary
                    req = requests.get(API_BASE + "sensor/live.json?" + API_KEY_PARAM + "&sensor_name=" + source)

                    # TODO handle error appropriately
                    # If not a network problem, should make a general area call for this sensor's vars
                    # For now, exit, and raise alert with mainframe to be displayed on dash?
                    all_data = req.json()[0]["data"];

                    print " - " + source + " successful"

                    # Iterate through this sensor's vars to construct the JSON file
                    for v in vars:

                        # Get the static details for this variable
                        v_details = SENSOR_DETAILS[v]

                        var_out = {
                          "name": "data-" + v_details["key"],
                          "label": v_details["label"],
                          "tagline": random.choice(v_details["taglines"]),
                          "description": v_details["description"]
                        }

                        # Locality
                        if locality == "local":
                            var_out["local"] = True
                            # NOTE this "source" field is now superfluous; should be handled on frontend
                            var_out["source"] = SOURCE_LOCAL
                        else :
                            var_out["local"] = False
                            # NOTE this "source" field is now superfluous; should be handled on frontend
                            var_out["source"] = SOURCE_REMOTE

                        # Reading, timestamp, and unit
                        var_data = all_data[v];

                        # NOTE: Expecting only one per variable
                        var_out["reading"] = parse_reading(var_data["data"].items()[0][1])

                        # Timestamp should be an int in milliseconds
                        # NOTE: This should get time in UTC
                        var_out["timestamp"] = get_ms_timestamp(var_data["data"].items()[0][0]);

                        # Units are translated here rather than frontend
                        var_out["units"] = translate_units(var_data["meta"]["units"])

                        ### Add this var to outfile for this totem
                        totem_data[v_details["key"]] = var_out;

                except Exception as e:
                    # TODO Alert Mainframe to error
                    print "Error getting readings for sensor " + source
                    print e
                    continue

    # SAVE AND UPLOAD THIS OUTFILE
    with open('sensors-totem-'+ str(totem_id) +'.json', 'w') as outfile:
        json.dump(totem_data, outfile)

    s3 = boto3.resource(
        's3',
         aws_access_key_id=ACCESS_KEY_ID,
         aws_secret_access_key=ACCESS_SECRET_KEY,
         config=Config(signature_version='s3v4')
    )

    s3.Bucket(BUCKET_NAME).upload_file('sensors-totem-'+ str(totem_id) +'.json', 'sensors-totem-'+str(totem_id)+'.json', ExtraArgs={'ContentType': "application/json", 'ACL':'public-read'})

    print "Successfully uploaded data for totem " + str(totem_id)
