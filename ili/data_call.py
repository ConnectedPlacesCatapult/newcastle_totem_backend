import googlemaps
import json
import requests
from datetime import datetime
from random import randint
from scipy.stats import logistic
import random
from time import gmtime, strftime
from geopy.distance import vincenty
from itertools import chain
import os
import gspread
from oauth2client.service_account import ServiceAccountCredentials
import pandas as pd
import boto3
from botocore.client import Config
import sys

## Totem location. This has to be variable. For now it is hardcoced. totem_location_2 is a dummy variable that doesn't influence the results
totem_lat = 54.972352
totem_lon = -1.622857

totem_location_1_lat = totem_lat
totem_location_1_lon = totem_lon
totem_location_2_lat = 54.979988
totem_location_2_lon = -1.611195

## Load totem details from config
with open('../totem_details.json') as totem_details:
    totems = json.load(totem_details)

## Load keys from shared location
with open('../keys.json') as keys:
    keys = json.load(keys)

## Load back POI data
with open('places_all.json') as places_all:
    places_all = json.load(places_all)

##### Calling google places as backoff when there's no data nearby
def call_google_places(totem_location_lat,totem_location_lon, subcategory, jitter):
    gmaps = googlemaps.Client(key=keys["gmaps_key"])
    places = []

    if subcategory == 'bar' or subcategory == 'pub':
        print "Google backoff: Adding pubs/bars",
        sys.stdout.flush()
        nearby_result_bar = gmaps.places_nearby(location=[totem_location_lat, totem_location_lon],radius = jitter,
                                           open_now=True, type='bar')
        nearby_result_pub = gmaps.places_nearby(location=[totem_location_lat, totem_location_lon],radius = jitter,
                                           open_now=True, keyword='pub')
        places.extend(nearby_result_bar['results'])
        places.extend(nearby_result_pub['results'])

    elif subcategory == 'cafe':
    	print "Google backoff: Adding cafes",
        sys.stdout.flush()
        nearby_result_cafe = gmaps.places_nearby(location=[totem_location_lat, totem_location_lon],radius = jitter,
                                           open_now=True, type='cafe')
        places.extend(nearby_result_cafe['results'])
    elif subcategory == 'restaurant':
    	print "Google backoff: Adding restaurants",
        sys.stdout.flush()
        nearby_result_restaurant = gmaps.places_nearby(location=[totem_location_lat, totem_location_lon],radius = jitter,
                                           open_now=True, type='restaurant')
        places.extend(nearby_result_restaurant['results'])


    filter_duplicates = {json.dumps(d, sort_keys=True) for d in places}
    places = [json.loads(t) for t in filter_duplicates]

    places_gmaps = []

    ## cleaning googlemaps
    # get only the one that has subcategory as a first type
    for i in places:
        if subcategory == i['types'][0]:
            temp = {}
            temp['category'] = 'food_drinks'
            temp['coordinates'] = [i['geometry']['location']['lng'], i['geometry']['location']['lat']]
            temp['name'] = i['name']
            temp['source'] = 'google'
            temp['properties'] = [{'subcategory': i['types'][0],
                                            'distance_to_totem_1' : vincenty((i['geometry']['location']['lat'],i['geometry']['location']['lng']),(totem_location_lat,
                                                                                              totem_location_lon)).meters}]
            places_gmaps.append(temp)
        else:
            pass

    return places_gmaps

import googlemaps

##### Routing response is encrypted. Below function decodes it
def decode_polyline(polyline_str):
    index, lat, lng = 0, 0, 0
    coordinates = []
    changes = {'latitude': 0, 'longitude': 0}

    # Coordinates have variable length when encoded, so just keep
    # track of whether we've hit the end of the string. In each
    # while loop iteration, a single coordinate is decoded.
    while index < len(polyline_str):
        # Gather lat/lon changes, store them in a dictionary to apply them later
        for unit in ['latitude', 'longitude']:
            shift, result = 0, 0

            while True:
                byte = ord(polyline_str[index]) - 63
                index+=1
                result |= (byte & 0x1f) << shift
                shift += 5
                if not byte >= 0x20:
                    break

            if (result & 1):
                changes[unit] = ~(result >> 1)
            else:
                changes[unit] = (result >> 1)

        lat += changes['latitude']
        lng += changes['longitude']

        coordinates.append((lat / 100000.0, lng / 100000.0))

    return coordinates

##### Getting closest POIS
def get_closest(category, places_all, dist):
    if isinstance(category, list):
        closest_totem1 = filter(lambda d: d['properties'][0]['distance_to_totem_1'] < dist,
               filter(lambda d: d['category'] in [i for i in category], places_all))
    else:
        closest_totem1 = filter(lambda d: d['properties'][0]['distance_to_totem_1'] < dist,
               filter(lambda d: d['category'] in [category], places_all))

    return closest_totem1

##### Calling dark sky
def dark_sky_call(totem_lat, totem_lon):
    page = 'https://api.darksky.net/forecast/'+keys["darksky_key"]+'/{0},{1}'.format(totem_lat,totem_lon)
    r = requests.get(page)
    data = r.json()
    precipIntensity = list(data["minutely"]["data"][-1].values())[0]
    precipProbability = list(data["minutely"]["data"][-1].values())[1]

    ### Farenheit to Celsius
    temperature = (data["currently"]["apparentTemperature"]- 32) / 1.8

    ### Getting clear weather flag to trigger park recomendation
    clear = data["currently"]["icon"]

    two_hours_from_now_temperature = (data["hourly"]['data'][4]["apparentTemperature"]- 32) / 1.8
    two_hours_from_now_precipProbability = data["hourly"]['data'][4]["precipProbability"]
    two_hours_from_now_clear = data["hourly"]['data'][4]["icon"]

    return precipProbability, temperature, clear,two_hours_from_now_precipProbability, two_hours_from_now_temperature,two_hours_from_now_clear

##### Flipping a biased coin as to weather to generate a recommendation or not
def flip(p):
    return 1 if random.random() < p else 0


##### Recommendation engine. minutes is the maximum allowable walking distance. places_all is the pois file
def recommendation_poi(minutes, totem_lat, totem_lon, places_all):

    now = datetime.now().hour
    rain_probability = weather_data[0]
    temperature = logistic.cdf(weather_data[1],loc=12, scale=5)
    clear = weather_data[2]

    ##### Adding the max walking distance
    if minutes == 5:
        jitter = random.randint(4,8)
    elif minutes == 15:
        jitter = random.randint(10,17)
    else:
        jitter = random.randint(28,35)

    ##### Adding subcategories per day
    if now >=8 and now <12:
        subcategories = ['cafe']
        extended_categories = ['tranquility']
        extended_categories2 = ['culture', 'attractions']
    elif now >=12 and now <3:
        subcategories = ['restaurant']
        extended_categories = ['food_drinks','tranquility']
        extended_categories2 = ['culture', 'attractions']
    else:
        subcategories = ['bar']
        extended_categories = ['food_drinks','tranquility']
        extended_categories2 = ['culture', 'attractions']

    #### TODO BEGIN Wrapping condition for GNE

    #### BEGIN check for event --> send to event
    # filtering events if they are due to start (two hours from now)

    ### flip coin for events
    flip_coin = flip(0.6)
    #print flip_coin
    if flip_coin == 1:
        events = filter(lambda d: (datetime.strptime(d['properties'][0]['start'],
                                       '%Y-%m-%dT%H:%M:%S').day == datetime.now().day and (datetime.strptime(d['properties'][0]['start'],
                                       '%Y-%m-%dT%H:%M:%S').hour  - now <= 2 and datetime.strptime(d['properties'][0]['start'],
                                       '%Y-%m-%dT%H:%M:%S').hour - now > 0) ),
                        get_closest('event', places_all, 1.4 * 60 * jitter))


    else:
        events = []
    ###

    # If there are no events starting one hours from now
    if not events:
        #print 'no events'

        # check for clear weather --> send to park
        if "clear" in clear:
            #print "its clear!"

            recommendation = random.sample(filter(lambda d: d['category'] in 'tranquility',
                                     get_closest('tranquility', places_all, 1.4 * 60 * jitter)), 1)

            # calculating the route
            gmaps_route = googlemaps.Client(key=keys["groutes_key"])
            route = gmaps_route.directions(origin=[totem_lat,
                                                   totem_lon],
                                           destination = [float(recommendation[0]['coordinates'][1]),
                                                          float(recommendation[0]['coordinates'][0])],
                                    mode='walking', units='metric')
            polyline = []
            for i in route[0]['legs'][0]['steps']:
                polyline.extend(decode_polyline(i['polyline']['points']))

            recommendation[0]['properties'][0]['route_direct'] = polyline

        else:
            # check for rain --> send to cafe
            if rain_probability > 0.5:
                #print "its raining"
                data = filter(lambda d: d['properties'][0]['subcategory'] in subcategories,
                                     get_closest('food_drinks', places_all, 1.4 * 60 * jitter))

                if not data:
                    #print subcategories
                    data = call_google_places(totem_lat, totem_lon, subcategories, 1.4 * 60 * jitter)
                    data.extend(get_closest(extended_categories,
                               places_all, 1.4 * 60 * jitter))
                else:
                    data.extend(get_closest(extended_categories,
                               places_all, 1.4 * 60 * jitter))
                    recommendation = random.sample(data,1)

                # random sample from the first three entries
                recommendation = random.sample(data[0:3],1)
                # calculating the route
                gmaps_route = googlemaps.Client(key=keys["groutes_key"])
                route = gmaps_route.directions(origin=[totem_lat,
                                                       totem_lon],
                                               destination = [float(recommendation[0]['coordinates'][1]),
                                                              float(recommendation[0]['coordinates'][0])],
                                        mode='walking', units='metric')
                polyline = []
                for i in route[0]['legs'][0]['steps']:
                    polyline.extend(decode_polyline(i['polyline']['points']))

                recommendation[0]['properties'][0]['route_direct'] = polyline
            # check for rain and high temperature --> pick randomly from cafe or tranquillity
            elif rain_probability < 0.5 and temperature > 0.5:
                #print "its hot!"

                data = filter(lambda d: d['properties'][0]['subcategory'] in subcategories[0],
                     get_closest('food_drinks', places_all, 1.4 * 60 * jitter))

                if not data:
                    data = call_google_places(totem_lat, totem_lon, subcategories[0], 1.4 * 60 * jitter)

                    data.extend(get_closest(extended_categories,
                               places_all, 1.4 * 60 * jitter))
                else:
                    data.extend(get_closest(extended_categories,
                               places_all, 1.4 * 60 * jitter))
                    recommendation = random.sample(data,1)

                # random sample from the first three entries
                recommendation = random.sample(data[0:3],1)

                # calculating the route
                gmaps_route = googlemaps.Client(key=keys["groutes_key"])
                route = gmaps_route.directions(origin=[totem_lat,
                                                       totem_lon],
                                               destination = [float(recommendation[0]['coordinates'][1]),
                                                              float(recommendation[0]['coordinates'][0])],
                                        mode='walking', units='metric')
                polyline = []
                for i in route[0]['legs'][0]['steps']:
                    polyline.extend(decode_polyline(i['polyline']['points']))

                recommendation[0]['properties'][0]['route_direct'] = polyline

            # check for rain and low temperature --> send to cafe or culture or attractions
            elif rain_probability < 0.5 and temperature < 0.5:
                #print "its cold!"
                data = filter(lambda d: d['properties'][0]['subcategory'] in subcategories[0],
                                     get_closest('food_drinks', places_all, 1.4 * 60 * jitter))

                if not data:
                    data = call_google_places(totem_lat, totem_lon, subcategories[0], 1.4 * 60 * jitter)
                    data.extend(get_closest(extended_categories,
                               places_all, 1.4 * 60 * jitter))
                else:
                    data.extend(get_closest(extended_categories,
                               places_all, 1.4 * 60 * jitter))

                # random sample from the first three entries
                recommendation = random.sample(data[0:3],1)

                # calculating the route
                gmaps_route = googlemaps.Client(key=keys["groutes_key"])
                route = gmaps_route.directions(origin=[totem_lat,
                                                       totem_lon],
                                               destination = [float(recommendation[0]['coordinates'][1]),
                                                              float(recommendation[0]['coordinates'][0])],
                                        mode='walking', units='metric')
                polyline = []
                for i in route[0]['legs'][0]['steps']:
                    polyline.extend(decode_polyline(i['polyline']['points']))

                recommendation[0]['properties'][0]['route_direct'] = polyline

    # there is an event that early --> event
    else:
        recommendation = random.sample(events,1)
        # calculating the route
        gmaps_route = googlemaps.Client(key=keys["groutes_key"])
        route = gmaps_route.directions(origin=[totem_lat,
                                               totem_lon],
                                       destination = [float(recommendation[0]['coordinates'][1]),
                                                      float(recommendation[0]['coordinates'][0])],
                                mode='walking', units='metric')
        polyline = []
        for i in route[0]['legs'][0]['steps']:
            polyline.extend(decode_polyline(i['polyline']['points']))

        recommendation[0]['properties'][0]['route_direct'] = polyline
    return recommendation

##### Adding intermediate stops
def adding_stopovers(minutes ,totem_lat, totem_lon, recommendation):
    if minutes == 15:

        # adding a one stopover --> attraction
        stopover = random.sample(filter(lambda d: (d['category'] == 'attractions' and d['properties'][0]['distance_to_totem_1'] < 300), places_all),1)

        # calculating the route
        gmaps_route = googlemaps.Client(key=keys["groutes_key"])
        route = gmaps_route.directions(origin=[totem_lat,
                                               totem_lon],
                                       destination = [float(recommendation[0]['coordinates'][1]),
                                                      float(recommendation[0]['coordinates'][0])],
                                       waypoints = [(float(stopover[0]['coordinates'][1]),
                                                   float(stopover[0]['coordinates'][0]))],
                                mode='walking', units='metric')
        polyline = []
        for l in route[0]['legs']:
            for i in l['steps']:
                polyline.extend(decode_polyline(i['polyline']['points']))

        recommendation[0]['properties'][0]['route_leisure'] = polyline #str(LineString(polyline))
        recommendation[0]['properties'][0]['stopovers_leisure'] = [{'subcategory': stopover[0]['properties'][0]['subcategory'],
                                                            'coordinates' : stopover[0]['coordinates'],
                                                            'name': stopover[0]['name'],
                                                            'category': stopover[0]['category']}]
    elif minutes == 30:
        # adding two stopevers --> attraction, culture, tranquility
        stopover = random.sample(filter(lambda d: ((d['category'] == 'attractions' or d['category'] == 'culture' or d['category'] == 'tranquility') and (d['properties'][0]['distance_to_totem_1'] < 500)),
                             places_all),2)

        # calculating the route
        gmaps_route = googlemaps.Client(key=keys["groutes_key"])
        route = gmaps_route.directions(origin=[totem_lat,
                                               totem_lon],
                                       destination = [float(recommendation[0]['coordinates'][1]),
                                                      float(recommendation[0]['coordinates'][0])],
                                       waypoints = [(float(stopover[0]['coordinates'][1]),
                                                   float(stopover[0]['coordinates'][0])),
                                                   (float(stopover[1]['coordinates'][1]),
                                                   float(stopover[1]['coordinates'][0]))],
                                mode='walking', units='metric')
        polyline = []
        for l in route[0]['legs']:
            for i in l['steps']:
                polyline.extend(decode_polyline(i['polyline']['points']))

        recommendation[0]['properties'][0]['route_curious'] = polyline #str(LineString(polyline))
        recommendation[0]['properties'][0]['stopovers_curious'] = [{'subcategory': stopover[0]['properties'][0]['subcategory'],
                                                            'coordinates' : stopover[0]['coordinates'],
                                                            'name': stopover[0]['name'],
                                                            'category': stopover[0]['category']},
                                                          {'subcategory': stopover[1]['properties'][0]['subcategory'],
                                                           'coordinates' : stopover[1]['coordinates'],
                                                           'name': stopover[0]['name'],
                                                           'category': stopover[0]['category']}]
    else:
        pass
    return recommendation

################################################################################

# filtering the previous day recommendation
try:
    for file in os.listdir("~/information_local_influencer"):
        if "recommendation" in file:
            with open(os.path.join("~/information_local_influencer", file)) as recommendation:
                #print "Filtering: ", recommendation[0]['name']
                places_all = filter(lambda d: d['name'] != recommendation[0]['name'], places_all)
except Exception, e:
    pass

## Getting weather data
weather_data = dark_sky_call(totem_location_1_lat,totem_location_1_lon)

recommendation = recommendation_poi(15, totem_location_1_lat, totem_location_1_lon, places_all)

adding_stopovers(15, totem_location_1_lat, totem_location_1_lon, recommendation)
adding_stopovers(30, totem_location_1_lat, totem_location_1_lon, recommendation)

places_temp = []
places_temp.append([i for i in recommendation[0]['properties'][0]['stopovers_leisure']])
places_temp.append([i for i in recommendation[0]['properties'][0]['stopovers_curious']])


###### Choosing and adding the rest of map POIS
def flatten(lst):
    "Flatten one level of nesting"
    return chain.from_iterable(lst)


places_temp = list(flatten(places_temp))


tranquility  = random.sample(filter(lambda d: d['properties'][0]['subcategory'] in ['park', 'gardens'],
                     get_closest('tranquility', places_all, 1.4 * 60 * 30)),
                             3-len(filter(lambda c: c['category'] == 'tranquility', places_temp)))

tranquility.append(filter(lambda c: c['category'] == 'tranquility', places_temp))


places_rest = []

for i in tranquility:
    if isinstance(i, list):
        for j in i:
            places_rest.append(j)
    else:
        places_rest.append(i)

places_temp = []
places_temp.append([i for i in recommendation[0]['properties'][0]['stopovers_leisure']])
places_temp.append([i for i in recommendation[0]['properties'][0]['stopovers_curious']])

places_temp = list(flatten(places_temp))

attractions  = random.sample(filter(lambda d: d['category'] ==  'attractions',
                     get_closest('attractions', places_all, 1.4 * 60 * 30)),
                             3-len(filter(lambda c: c['category'] == 'attractions', places_temp)))

attractions.append(filter(lambda c: c['category'] == 'attractions', places_temp))

for i in attractions:
    if isinstance(i, list):
        for j in i:
            places_rest.append(j)
    else:
        places_rest.append(i)


places_temp = []
places_temp.append([i for i in recommendation[0]['properties'][0]['stopovers_leisure']])
places_temp.append([i for i in recommendation[0]['properties'][0]['stopovers_curious']])

places_temp = list(flatten(places_temp))

culture  = random.sample(filter(lambda d: d['category'] ==  'culture',
                     get_closest('culture', places_all, 1.4 * 60 * 30)),
                             3-len(filter(lambda c: c['category'] == 'culture', places_temp)))

culture.append(filter(lambda c: c['category'] == 'culture', places_temp))

for i in culture:
    if isinstance(i, list):
        for j in i:
            places_rest.append(j)
    else:
        places_rest.append(i)

places_temp = []
places_temp.append([i for i in recommendation[0]['properties'][0]['stopovers_leisure']])
places_temp.append([i for i in recommendation[0]['properties'][0]['stopovers_curious']])

places_temp = list(flatten(places_temp))

food_drinks  = random.sample(filter(lambda d: d['category'] ==  'food_drinks',
                     get_closest('food_drinks', places_all, 1.4 * 60 * 30)),
                             3-len(filter(lambda c: c['category'] == 'food_drinks', places_temp)))

food_drinks.append(filter(lambda c: c['category'] == 'food_drinks', places_temp))

for i in food_drinks:
    if isinstance(i, list):
        for j in i:
            places_rest.append(j)
    else:
        places_rest.append(i)


recommendation[0]['properties'][0]['amenities'] = places_rest
recommendation[0]['properties'][0]['two_hour_rain_forecast'] = weather_data[3]
recommendation[0]['properties'][0]['two_hour_temperature_forecast'] = weather_data[4]
recommendation[0]['properties'][0]['two_hour_weather_forecast'] = weather_data[5]


##### Adding counter numbers and ensuring that the recomendation appears in the amenities list

rest_events  = random.sample(filter(lambda d: d['category'] in 'event',
                                    get_closest('event', places_all, 1.4 * 60 * 30)), 3)


for i in rest_events:
    if isinstance(i, list):
        for j in i:
            places_rest.append(j)
    else:
        places_rest.append(i)


amenities_matching_rec = filter(lambda d: d['category'] in recommendation[0]['category'], recommendation[0]['properties'][0]['amenities'])

## the below will be empty if the recommendation is not in the list
matching_flag = filter(lambda d: d['name'] in recommendation[0]['category'], amenities_matching_rec)
if not matching_flag:
    temp = {}
    temp['category'] = recommendation[0]['category']
    temp['coordinates'] = recommendation[0]['coordinates']
    temp['name'] = recommendation[0]['name']
    temp['subcategory'] = recommendation[0]['properties'][0]['subcategory']
    ## Adding the remaining attributes if the recommendation is an event
    if temp['category'] == 'event':
        temp['address'] = recommendation[0]['address']
        temp['properties'] = [{'start': recommendation[0]['properties'][0]['start'],
                                'free': recommendation[0]['properties'][0]['free'],
                                'description': recommendation[0]['properties'][0]['description']}]

    ## replace the first amenities entry with the recommendation
    recommendation[0]['properties'][0]['amenities'][0] = temp



## Adding the counter
counter = 1
for i in range(0, len(recommendation[0]['properties'][0]['amenities'])):
    recommendation[0]['properties'][0]['amenities'][i]['counter'] = counter
    counter = counter+1

###### Add permanent pois
## toilets
recommendation[0]['properties'][0]['amenities'].extend(filter(lambda d: d['category'] == 'toilet', places_all))
## water
recommendation[0]['properties'][0]['amenities'].extend(filter(lambda d: d['category'] == 'water', places_all))

###### Add semantics
# Connect to google sheet
scope = ['https://spreadsheets.google.com/feeds',
        'https://www.googleapis.com/auth/drive']
creds = ServiceAccountCredentials.from_json_keyfile_name('../client_secret.json', scope)
client = gspread.authorize(creds)

# Find a workbook by name and open the first sheet
# Make sure you use the right name here.
sheet = client.open("totem_messages").sheet1

# Extract all of the values
list_of_hashes = sheet.get_all_records()
df = pd.DataFrame(list_of_hashes)
df = df.loc[0:10]

now = datetime.now().hour
day_number = datetime.now().weekday()
rain_probability = weather_data[0]
temperature = logistic.cdf(weather_data[1],loc=12, scale=5)
clear = weather_data[2]


anytime = ["Aareet!", "Hey there!", "You look nice!", "Alreet Hen!"]

weekday_morning =  filter(None,list(df['Weekday Morning (6am-11am)'].values))
weekday_lunch = filter(None,list(df['Weekday Lunch (11am-3pm)'].values))
weekday_afternoon = filter(None,list(df['Weekday Afternoon (3-6pm)'].values))
weekday_evening = filter(None,list(df['Weekday Evening (6-8pm)'].values))
weekday_late_evening = filter(None,list(df['Weekday Late Evening (8pm-1am)'].values))
weekday_night = filter(None,list(df['Weekday Nighttime (1-6am)'].values))
weekend = filter(None,list(df['Weekend'].values))

sun_cold = filter(None,list(df['Sun cold'].values))
sun_warm = filter(None,list(df['Sun warm'].values))
cloudy_cold = filter(None,list(df['Cloudy cold'].values))
cloudy_warm = filter(None,list(df['Cloudy warm'].values))

rainy = filter(None,list(df['Rainy'].values))
hot = filter(None,list(df['Hot'].values))
food = filter(None,list(df['Food'].values))
drinks = filter(None,list(df['Drink'].values))
attractions = filter(None,list(df['Attractions'].values))
culture = filter(None,list(df['Culture'].values))
tranquility = filter(None,list(df['Tranquility'].values))
event = filter(None,list(df['Events'].values))

action_msg = ''

if day_number == 5 or day_number == 6:
    action_msg = weekend[random.sample(xrange(len(weekend)), 1)[0]]
else:
#     action_msg = anytime[random.sample(xrange(len(anytime)), 1)[0]]
    if now >=6 and now <=11:
        action_msg =  weekday_morning[random.sample(xrange(len(weekday_morning)), 1)[0]]
    elif now >11 and now <=15:
        action_msg =  weekday_lunch[random.sample(xrange(len(weekday_lunch)), 1)[0]]
    elif now >15 and now <=18:
        action_msg =  weekday_afternoon[random.sample(xrange(len(weekday_afternoon)), 1)[0]]
    elif now >18 and now <=20:
        action_msg =  weekday_evening[random.sample(xrange(len(weekday_evening)), 1)[0]]
    elif now >20 and now <=1:
        action_msg = weekday_late_evening[random.sample(xrange(len(weekday_late_evening)), 1)[0]]
    else:
        action_msg =  weekday_night[random.sample(xrange(len(weekday_night)), 1)[0]]

if "rain" in recommendation[0]['properties'][0]['two_hour_weather_forecast']:
    action_msg = action_msg + "_" + rainy[random.sample(xrange(len(rainy)), 1)[0]]
else:
    if "clear" in clear and temperature <= 0.2:
        action_msg = action_msg + "_" + sun_cold[random.sample(xrange(len(sun_cold)), 1)[0]]
    elif "clear" in clear and temperature > 0.2 and temperature < 0.8:
        action_msg = action_msg + "_" + sun_warm[random.sample(xrange(len(sun_warm)), 1)[0]]
    elif "clear" in clear and temperature >= 0.8:
        action_msg = action_msg + "_" + hot[random.sample(xrange(len(hot)), 1)[0]]
    elif "cloudy" in clear and temperature <= 0.2:
        action_msg = action_msg + "_" + cloudy_cold[random.sample(xrange(len(cloudy_cold)), 1)[0]]
    elif "cloudy" in clear and temperature > 0.2:
        action_msg = action_msg + "_" + cloudy_warm[random.sample(xrange(len(cloudy_warm)), 1)[0]]
    elif "rain" in clear:
        action_msg = action_msg + "_" + rainy[random.sample(xrange(len(rainy)), 1)[0]]
    else:
        pass

if recommendation[0]['category'] == 'event':
    action_msg = action_msg + "_" + event[random.sample(xrange(len(event)), 1)[0]] + ":_" + recommendation[0]['name']
elif recommendation[0]['category'] == 'tranquility':
    action_msg = action_msg + "_" + tranquility[random.sample(xrange(len(tranquility)), 1)[0]] + ":_" + recommendation[0]['name']
elif recommendation[0]['category'] == 'culture':
    action_msg = action_msg + "_" + culture[random.sample(xrange(len(culture)), 1)[0]] + ":_" + recommendation[0]['name']
elif recommendation[0]['category'] == 'attractions':
    action_msg = action_msg + "_" + attractions[random.sample(xrange(len(attractions)), 1)[0]] + ":_" + recommendation[0]['name']
elif recommendation[0]['category'] == 'food_drinks':
    if  now >11 and now <=15:
        action_msg = action_msg + "_" + food[random.sample(xrange(len(food)), 1)[0]] + ":_" + recommendation[0]['name']
    elif now >15 and now <=2:
        action_msg = action_msg + "_" + drinks[random.sample(xrange(len(drinks)), 1)[0]] + ":_" + recommendation[0]['name']
    else:
        action_msg = action_msg + "_" + food[random.sample(xrange(len(food)), 1)[0]] + ":_" + recommendation[0]['name']


## Cropping the action msg
#action_msg = random.choice(action_msg.split('_')[0:2]) + '_' + action_msg.split('_')[2] + '_' + action_msg.split('_')[3]
action_msg = random.choice(action_msg.split('_')[0:3]) + '_' + action_msg.split('_')[3]
#print action_msg

recommendation[0]['action_msg'] = action_msg
recommendation[0]['totem_coords'] = [totem_location_1_lon,totem_location_1_lat]

## Saving recommendation for further checking and uploading to s3
uploading_date = datetime.today()
#print datetime.today()
with open('recommendation-totem-1.json', 'w') as outfile:
    json.dump(recommendation, outfile)

#with open('recommendation_'+datetime.strftime( uploading_date, "%Y-%m-%d_%H")+'.json', 'w') as outfile:
#    json.dump(recommendation, outfile)

ACCESS_KEY_ID = keys["boto3_access_key"]
ACCESS_SECRET_KEY = keys["boto3_secret_access_key"]
BUCKET_NAME = keys["bucket_name"]
s3 = boto3.resource(
    's3',
     aws_access_key_id=ACCESS_KEY_ID,
     aws_secret_access_key=ACCESS_SECRET_KEY,
     config=Config(signature_version='s3v4')
)

s3.Bucket(BUCKET_NAME).upload_file('recommendation-totem-1.json',
                                   'recommendation-totem-1.json', ExtraArgs={'ContentType': "application/json",
                                                                                                'ACL':'public-read'})
