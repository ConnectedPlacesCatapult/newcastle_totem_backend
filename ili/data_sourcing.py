from geopy.distance import great_circle
import json, requests
import numpy as np
from eventbrite import Eventbrite
from datetime import datetime, time

## Load keys from shared location
with open('../keys.json') as keys:
    keys = json.load(keys)


##### Foursquare sourcing.
##### Getting the trending places by constructing a grid and searching by 100 meters radius

def point_from_d_horizontal(x1, y1, d, theta):
    # d=0.0029 around 200m
    y2 = y1 + d * np.cos(theta)
    x2 = x1 + d * np.sin(theta)
    return x2,y2

def point_from_d_vertical(x1, y1, d, theta):
    # d=0.0029 around 200m
    y2 = y1 + d * np.sin(theta)
    x2 = x1 + d * np.cos(theta)
    return x2,y2


## construct the grid for Foursuare calls

coords = []

p = [54.979180, -1.578230]

flip=False

for i in range(25*8):
    if flip == False:
        if not i%20 == 0:
            p = point_from_d_horizontal(p[0], p[1], 0.0029, 0)
            coords.append(p)
        else:
            p = point_from_d_vertical(p[0], p[1], 0.0029, 0)
            coords.append(p)
            flip = True
    elif flip == True:
        if not i%20 == 0:
            p = point_from_d_horizontal(p[0], p[1], -0.0029, 0)
            coords.append(p)
        else:
            p = point_from_d_vertical(p[0], p[1], 0.0029, 0)
            coords.append(p)
            flip = False

## Foursquare calls
url = 'https://api.foursquare.com/v2/venues/explore'

responses = []
for i in coords:

    params = dict(
      client_id=keys["fs_client_id"],
      client_secret=keys["fs_client_secret"],
      v='20180323',
      ll='{0},{1}'.format(i[0], i[1]),
      section = 'trending',
      radius=100
    )

    resp = requests.get(url=url, params=params)
    responses.append(json.loads(resp.text))

## Save data to a file so they can be referenced later
with open('foursquare.json', 'wb') as outfile:
    json.dump(responses, outfile)


##### Eventbrite sourcing.
##### Getting todays events for all categories.

search_args = {"location.latitude": "54.967155",
               "location.longitude": "-1.613736",
               "location.within": "5km",
               "start_date.keyword": "today"}

def tod_events(search_args, category, am_end, pm_st):
    eventbrite = Eventbrite(keys["eventbrite_key"])
    events = eventbrite.event_search(**search_args)
    ## Use this for filtering
#     events = [x for x in events['events'] if x['category_id'] == "103"]

    events = [x for x in events['events']]

    for item in events:
        location_id = eventbrite.get('/venues/' + str(item['venue_id']))
        item.update( {"latitude": location_id['latitude']})
        item.update( {"longitude": location_id['longitude']})
        item.update( {"address": location_id['address']})

    return events


eventbrite = tod_events(search_args, '', 10, 23)

## Save data to a file so they can be referenced later
with open('eventbrite_events.json', 'wb') as outfile:
    json.dump(eventbrite, outfile)

##### Meetup sourcing.
##### Getting todays events for all categories.

r = requests.get("https://api.meetup.com/find/groups?lat=54.967155&lon=-1.613736&radius=5&order=members&key="+keys["meetup_key"])

events = r.json()
for item in events:
    try:
        location_id = requests.get("https://api.meetup.com/2/venues?&event_id={0}&key="+meetup_key.format(item['next_event']['id'])).json()
        item["lat"] = location_id['results'][0]['lat']
        item["lon"] = location_id['results'][0]['lon']
        item["address"] = location_id['results'][0]['address_1']
    except Exception, e:
        print str(e)
        item["address"] = None

## Save data to a file so they can be referenced later
with open('meetup_events.json', 'wb') as outfile:
    json.dump(events, outfile)
