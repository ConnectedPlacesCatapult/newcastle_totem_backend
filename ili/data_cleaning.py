import json
from geopy.distance import vincenty
from eventbrite import Eventbrite
from shapely.geometry import Polygon, LineString
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from datetime import datetime
import googlemaps
##### Loading the data locally

with open('foursquare.json') as json_file:
    data_fs = json.load(json_file)

with open('static_data/toilets_newcastle_osm.geojson') as json_file:
    data_toilets = json.load(json_file)

with open('static_data/park_newcastle_osm.geojson') as json_file:
    data_park = json.load(json_file)

with open('static_data/benches_newcastle_osm.geojson') as json_file:
    data_benches = json.load(json_file)

with open('static_data/gardens_newcastle_osm.geojson') as json_file:
    data_gardens = json.load(json_file)

with open('static_data/viewpoints_newcastle_osm.geojson') as json_file:
    data_viewpoints = json.load(json_file)

with open('static_data/museum_newcastle_osm.geojson') as json_file:
    data_museum = json.load(json_file)

with open('static_data/monument_newcastle_osm.geojson') as json_file:
    data_monument = json.load(json_file)

with open('static_data/sculpture_newcastle_osm.geojson') as json_file:
    data_sculpture = json.load(json_file)

with open('static_data/bridge_newcastle_osm.geojson') as json_file:
    data_bridge = json.load(json_file)

with open('eventbrite_events.json') as json_file:
    data_eventbrite = json.load(json_file)

with open('meetup_events.json') as json_file:
    data_meetup = json.load(json_file)

with open('static_data/water.json') as json_file:
    data_water = json.load(json_file)

## Placeholder for all pois
places_all = []

## Load keys from shared location
with open('../keys.json') as keys:
    keys = json.load(keys)

## Totem location. This has to be variable. For now it is hardcoced. totem_location_2 is a dummy variable that doesn't influence the results
totem_lat = 54.972352
totem_lon = -1.622857
## science helix totem
totem_location_1_lat = totem_lat
totem_location_1_lon = totem_lon
totem_location_2_lat = 54.979988
totem_location_2_lon = -1.611195


##### Ouseburn values events scrapping and cleaning
opts = Options()
opts.add_argument("user-agent=testcrawl")

driver = webdriver.Chrome('chromedriver', chrome_options=opts)
driver.get("https://www.facebook.com/pg/ouseburnvalley/events/?ref=page_internal")

gmaps = googlemaps.Client(key=keys["gmaps_key"])

fb_events = []
for i in xrange(2,8):
    s = driver.find_elements_by_xpath('//*[@id="upcoming_events_card"]/div/div[{0}]/table/tbody'.format(str(i)))
    fb_events.append(s[0].text)
driver.close()

for i in fb_events:
    ### split th web element by new line
    d = i.split('\n')
    ### start populating the evet
    places = {}
    try:
        places['category'] = 'event'
        places['name'] = d[2]

        if d[4] == 'Ouseburn Valley':
            places['coordinates'] = [-1.592383, 54.974767]
            places['address'] = "Ouseburn Valley"
        else:
            geocode_result = gmaps.geocode('{0}, Newcastle, UK'.format(d[4]))
            places['coordinates'] = [geocode_result[0]['geometry']['location']['lng'],
                                     geocode_result[0]['geometry']['location']['lat']]

            # The list of geocoded result varies...
            if len(geocode_result[0]['address_components']) < 7:
                places['address'] = geocode_result[0]['address_components'][1]['long_name'] +' '+ geocode_result[0]['address_components'][0]['short_name'] +' '+ geocode_result[0]['address_components'][5]['short_name']
            elif len(geocode_result[0]['address_components']) > 7 and len(geocode_result[0]['address_components']) <=8:
                places['address'] = geocode_result[0]['address_components'][1]['long_name'] +' '+ geocode_result[0]['address_components'][0]['short_name'] +' '+ geocode_result[0]['address_components'][7]['short_name']
            else:
                places['address'] = geocode_result[0]['address_components'][1]['long_name'] +' '+ geocode_result[0]['address_components'][0]['short_name'] +' '+ geocode_result[0]['address_components'][6]['short_name']

        places['source'] = 'facebook'

        places['properties'] = [{'free' : 'For more info see https://www.facebook.com/pg/ouseburnvalley/events',
                                 'start' : datetime.strftime((datetime.strptime('{0} {1} 2018 {2}'.format(d[0],d[1],d[3].split()[1] ), '%b %d %Y %H:%M')),
                                    '%Y-%m-%dT%H:%M:%S'),
                                 'description': 'For more info see https://www.facebook.com/pg/ouseburnvalley/events',
                                 'subcategory' : 'event',
                                 'distance_to_totem_1' : vincenty((geocode_result[0]['geometry']['location']['lat'],
                                                                   geocode_result[0]['geometry']['location']['lng']),(totem_location_1_lat,
                                                                                  totem_location_1_lon)).meters,
                                 'distance_to_totem_2' : vincenty((geocode_result[0]['geometry']['location']['lat'],
                                                                   geocode_result[0]['geometry']['location']['lng']),(totem_location_2_lat,
                                                                           totem_location_2_lon)).meters}]

        places_all.append(places)
    except Exception, e:
        print str(e)
        pass

##### Great North Exhibition events
# missing venues: Urban Sciences Building (2), TBA
gne_locations = [{"name": "Outside Great North Children's Hospital",
                 "coordinates": [-1.619430, 54.979066]},
                 {"name": "Great North Museum",
                 "coordinates": [-1.613033, 54.980316]},
                 {"name": "Northern Stage",
                 "coordinates": [-1.613964, 54.979329]},
                 {"name": "Sport Central",
                 "coordinates": [-1.606511, 54.978205]},
                 {"name": "St James' Park",
                 "coordinates": [-1.623040, 54.974965]},
                 {"name": "1up North @ Northumbria University",
                 "coordinates": [-1.607706, 54.976934]},
                 {"name": "Northumbria University Campus",
                 "coordinates": [-1.607529, 54.976777]},
                 {"name": "Newcastle City Library",
                 "coordinates": [-1.610294, 54.974970]},
                 {"name": "Laing Art Gallery",
                 "coordinates": [-1.609380, 54.974719]},
                 {"name": "Carliol House",
                 "coordinates": [-1.610166, 54.973503]},
                 {"name": "Tyneside Cinema",
                 "coordinates": [-1.612113, 54.973841]},
                 {"name": "Newcastle City Centre",
                 "coordinates": [-1.613140, 54.973812]},
                 {"name": "intu Eldon Square",
                 "coordinates": [-1.614667, 54.973559]},
                 {"name": "Theatre Royal Newcastle",
                 "coordinates": [-1.612300, 54.972728]},
                 {"name": "BALTIC 39, Newcastle upon Tyne",
                 "coordinates": [-1.612679, 54.971875]},
                 {"name": "The Gate",
                 "coordinates": [-1.620085, 54.972600]},
                 {"name": "Dance City",
                 "coordinates": [-1.622439, 54.970032]},
                 {"name": "Newcastle Central Station",
                 "coordinates": [-1.617404, 54.969048 ]},
                 {"name": "Discovery Museum",
                 "coordinates": [-1.624903, 54.969076]},
                 {"name": "The Mining Institute",
                 "coordinates": [-1.614290, 54.969366]},
                 {"name": "The Lit & Phil",
                 "coordinates": [-1.613840, 54.969438]},
                 {"name": "NBS",
                 "coordinates": [-1.612436, 54.969618]},
                 {"name": "St Nicholas Cathedral",
                 "coordinates": [-1.611175, 54.970058]},
                 {"name": "Cooper's Studios",
                 "coordinates": [-1.612673, 54.969234]},
                 {"name": "Side Gallery",
                 "coordinates": [-1.608170, 54.969195]},
                 {"name": "Live Theatre",
                 "coordinates": [-1.604866, 54.969965]},
                 {"name": "The Biscuit Factory",
                 "coordinates": [-1.597657, 54.976592]},
                 {"name": "Ouseburn Farm",
                 "coordinates": [-1.591532, 54.975339]},
                 {"name": "Ouseburn Valley",
                 "coordinates": [-1.592383, 54.974767]},
                 {"name": "Seven Stories, The National Centre for Children's Books",
                 "coordinates": [-1.592077, 54.974636]},
                 {"name": "Toffee Factory",
                 "coordinates": [-1.589857, 54.971813]},
                 {"name": "Times Square",
                 "coordinates": [-1.621141, 54.967811]},
                 {"name": "Life Science Centre",
                 "coordinates": [-1.620718, 54.967297]},
                 {"name": "Stephenson Quarter",
                 "coordinates": [-1.617639, 54.966952]},
                 {"name": "Boiler Shop",
                 "coordinates": [-1.615214, 54.967603]},
                 {"name": "Quayside",
                 "coordinates": [-1.600125, 54.970220]},
                 {"name": "Baltic Square",
                 "coordinates": [-1.598560, 54.969122]},
                 {"name": "BALTIC Centre for Contemporary Art",
                 "coordinates": [-1.598313, 54.969160]},
                 {"name": "Performance Square",
                 "coordinates": [-1.601086, 54.967788]},
                 {"name": "Sage Gateshead",
                 "coordinates": [-1.602068, 54.967677]},
                 {"name": "St Mary's Heritage Centre",
                 "coordinates": [-1.604080, 54.967194]},
                 {"name": "Northern Design Centre",
                 "coordinates": [-1.596122, 54.966685]},
                 {"name": "The NewBridge Project: Gateshead",
                 "coordinates": [-1.600832, 54.962247]}
                ]

driver = webdriver.Chrome('chromedriver', chrome_options=opts)
gne_events = []

for page in range(1,10):
    driver.get("https://getnorth2018.com/things-to-do/events-search-results/?sf_paged={0}#search-results".format(page))

    j = 0
    for i in range(1,13):
        while True:
            try:
                driver.execute_script("window.scrollTo(0, {0});".format(600 + j))
            except Exception, e:
                print str(e)
                break
        elem = driver.find_elements_by_xpath('//*[@id="search-results"]/div[1]/div[{0}]/article/a/div'.format(i))
        if len(elem) > 0:
            gne_events.append(elem[0].text)
        j = j+100

driver.close()

for i in gne_events:
    ### split th web element by new line
    d = i.split('\n')
    try:
        ### start populating the evetnts
        places = {}
        places['category'] = 'event'
        places['name'] = d[0].replace(u"\u2018", "'").replace(u"\u2019", "'")
        coords = filter(lambda s: s["name"] == d[1], gne_locations)[0]['coordinates']
        places['coordinates'] = coords

        places['address'] = d[1]
        places['source'] = 'gne'
        ## transform the date
        daterange = [datetime.strptime('{0} {1} 2018'.format(j.split(',')[0].split()[0], j.split(',')[0].split()[1]), '%B %d %Y') for j in gne_events[0].split('\n')[2].split('-')]
        ## check if current day falls within range
        ## if so, add the event to be libe today

        if datetime.today() >= daterange[0] and datetime.today() <= daterange[1]:
            places['properties'] = [{'free' : 'For more info see https://getnorth2018.com/',
                                     'start' : datetime.strftime(datetime.today(), '%Y-%m-%dT%H:%M:%S'),
                                     'description': 'For more info see https://getnorth2018.com/',
                                     'subcategory' : 'event',
                                     'distance_to_totem_1' : vincenty((coords[1],coords[0]),(totem_location_1_lat,
                                                                                      totem_location_1_lon)).meters,
                                     'distance_to_totem_2' : vincenty((coords[1],coords[0]),(totem_location_2_lat,
                                                                               totem_location_2_lon)).meters}]
            places_all.append(places)
        else:
            pass
    except Exception, e:
        print str(e)
        pass


##### Meetup cleaning and adding poi properties.
for i in data_meetup:
    places = {}
    try:
        places['category'] = 'event'
        places['name'] = i['name']
        places['address'] = i['address']
        places['coordinates'] = [i['lon'], i['lat']]
        places['source'] = 'meetup'
        places['properties'] = [{'free' : i['join_mode'],
                                'description' : i['description'],
                                'start' : datetime.utcfromtimestamp(int(i['next_event']['time'])/1000).strftime('%Y-%m-%dT%H:%M:%S'),
                                'subcategory' : i['category']['name'],
                                'distance_to_totem_1' : vincenty((i['lat'],i['lon']),(totem_location_1_lat,
                                                                                      totem_location_1_lon)).meters,
                                'distance_to_totem_2' : vincenty((i['lat'],i['lon']),(totem_location_2_lat,
                                                                                      totem_location_2_lon)).meters}]
        places_all.append(places)
    except Exception, e:
        if str(e) == 'KeyError':
            pass

##### Eventbrite cleaning and adding poi properties. Need to call the API again for the catgories.
eventbrite_categories = Eventbrite(keys["eventbrite_key"]).get_categories()['categories']
for i in filter(lambda d: d['category_id'] != None, data_eventbrite):
    places = {}
    places['category'] = 'event'
    places['name'] = i['name']['text']
    places['coordinates'] = [i['longitude'], i['latitude']]
    places['address'] = i['address']['address_1']
    places['source'] = 'eventbrite'
    places['properties'] = [{'free' : i['is_free'],
                           'start' : i['start']['local'],
                           'description': i['description']['text'],
                           'subcategory' : [x['name'] for x in eventbrite_categories  if x['id'] == i['category_id']][0],
                            'distance_to_totem_1' : vincenty((i['latitude'],i['longitude']),(totem_location_1_lat,
                                                                                      totem_location_1_lon)).meters,
                            'distance_to_totem_2' : vincenty((i['latitude'],i['longitude']),(totem_location_2_lat,
                                                                               totem_location_2_lon)).meters}]
    places_all.append(places)

## Filter out the events with no address
places_all = filter(lambda d: (d['category'] == 'event' and d['address'] != None), places_all)

##### Foursquare cleaning and adding poi properties
for i in range(len(data_fs)):
    places = {}
    try:
        for j in data_fs[i]['response']['groups'][0]['items']:
            subcategory  = j['venue']['categories'][0]['name']
            lat = j['venue']['location']['lat']
            lon = j['venue']['location']['lng']

            if 'Bar' in subcategory:
                places['category'] = 'food_drinks'
                places['properties'] = [{'subcategory' :  'bar',
                                        'distance_to_totem_1' : vincenty((lat,lon),(totem_location_1_lat,
                                                                                          totem_location_1_lon)).meters,
                                        'distance_to_totem_2' : vincenty((lat,lon),(totem_location_2_lat,
                                                                                   totem_location_2_lon)).meters}]
            elif 'Pub' in subcategory:
                places['category'] = 'food_drinks'
                places['properties'] = [{'subcategory' :  'pub',
                                        'distance_to_totem_1' : vincenty((lat,lon),(totem_location_1_lat,
                                                                                          totem_location_1_lon)).meters,
                                        'distance_to_totem_2' : vincenty((lat,lon),(totem_location_2_lat,
                                                                                   totem_location_2_lon)).meters}]
            elif 'Restaurant' in subcategory:
                places['category'] = 'food_drinks'
                places['properties'] = [{'subcategory' :  'restaurant',
                                        'distance_to_totem_1' : vincenty((lat,lon),(totem_location_1_lat,
                                                                                          totem_location_1_lon)).meters,
                                        'distance_to_totem_2' : vincenty((lat,lon),(totem_location_2_lat,
                                                                                   totem_location_2_lon)).meters}]
            elif 'Museum' in subcategory:
                places['category'] = 'culture'
                places['properties'] = [{'subcategory' :  'museum',
                                        'distance_to_totem_1' : vincenty((lat,lon),(totem_location_1_lat,
                                                                                          totem_location_1_lon)).meters,
                                        'distance_to_totem_2' : vincenty((lat,lon),(totem_location_2_lat,
                                                                                   totem_location_2_lon)).meters}]
            elif 'Outdoors' in subcategory:
                places['category'] = 'tranquility'
                places['properties'] = [{'subcategory' :  subcategory,
                                        'distance_to_totem_1' : vincenty((lat,lon),(totem_location_1_lat,
                                                                                          totem_location_1_lon)).meters,
                                        'distance_to_totem_2' : vincenty((lat,lon),(totem_location_2_lat,
                                                                                   totem_location_2_lon)).meters}]
            elif u'Caf\xe9s' in subcategory or 'Coffee Shop' in subcategory or u'Caf\xe9' in subcategory:
                places['category'] = 'food_drinks'
                places['properties'] = [{'subcategory' :  'cafe',
                                        'distance_to_totem_1' : vincenty((lat,lon),(totem_location_1_lat,
                                                                                          totem_location_1_lon)).meters,
                                        'distance_to_totem_2' : vincenty((lat,lon),(totem_location_2_lat,
                                                                                   totem_location_2_lon)).meters}]
            else:
                break
            name = j['venue']['name']

            source = 'foursquare'

            places['name'] = name
            places['coordinates'] = [lon, lat]
            places['source'] = source
        places_all.append(places)

    except KeyError, e:
        print str(e)
        pass




##### Refil hardcoded data
for i in data_water:
    places_all.append(i)


##### OSM data cleaning
## Toilets
for i in data_toilets['features']:
    places = {}
    places['category'] = 'toilet'

    ## find centroid if geometry is polygon
    if i['geometry']['type'] == 'Polygon':
        places['coordinates'] = [Polygon(i['geometry']['coordinates'][0]).centroid.x,
                                Polygon(i['geometry']['coordinates'][0]).centroid.y]
    elif i['geometry']['type'] == 'LineString':
        places['coordinates'] = [LineString(i['geometry']['coordinates'][0]).centroid.x,
                                LineString(i['geometry']['coordinates'][0]).centroid.y]
    else:
        places['coordinates'] = i['geometry']['coordinates']
    if 'name' in i['properties'].keys():
        places['name'] =  i['properties']['name']
    else:
        places['name'] =  'Toilet'
    if 'fee' in i['properties'].keys():
        places['properties'] =  [{'fee' : i['properties']['fee'],
                                    'distance_to_totem_1' : vincenty((places['coordinates'][1],places['coordinates'][0]),(totem_location_1_lat,
                                                                                      totem_location_1_lon)).meters,
                                    'distance_to_totem_2' : vincenty((places['coordinates'][1],places['coordinates'][0]),(totem_location_2_lat,
                                                                               totem_location_2_lon)).meters}]
    else:
        places['properties'] =  [{'fee' : None,
                                    'distance_to_totem_1' : vincenty((places['coordinates'][1],places['coordinates'][0]),(totem_location_1_lat,
                                                                                      totem_location_1_lon)).meters,
                                    'distance_to_totem_2' : vincenty((places['coordinates'][1],places['coordinates'][0]),(totem_location_2_lat,
                                                                               totem_location_2_lon)).meters}]

    places_all.append(places)

## Parks
for i in data_park['features']:
    places = {}
    places['category'] = 'tranquility'
    if i['geometry']['type'] == 'Polygon':
        places['coordinates'] = [Polygon(i['geometry']['coordinates'][0]).centroid.x,
                                Polygon(i['geometry']['coordinates'][0]).centroid.y]
    elif i['geometry']['type'] == 'LineString':
        places['coordinates'] = [LineString(i['geometry']['coordinates']).centroid.x,
                                LineString(i['geometry']['coordinates']).centroid.y]
    else:
        places['coordinates'] = i['geometry']['coordinates']

    if 'name' in i['properties'].keys():
        places['name'] =  i['properties']['name']
    else:
        places['name'] =  'Park'

    places['properties'] =  [{'subcategory' : 'park',
                                    'distance_to_totem_1' : vincenty((places['coordinates'][1],places['coordinates'][0]),(totem_location_1_lat,
                                                                                      totem_location_1_lon)).meters,
                                    'distance_to_totem_2' : vincenty((places['coordinates'][1],places['coordinates'][0]),(totem_location_2_lat,
                                                                               totem_location_2_lon)).meters}]
    places_all.append(places)


## Benches
for i in data_benches['features']:
    places = {}
    places['category'] = 'tranquility'
    if i['geometry']['type'] == 'Polygon':
        places['coordinates'] = [Polygon(i['geometry']['coordinates'][0]).centroid.x,
                                Polygon(i['geometry']['coordinates'][0]).centroid.y]
    elif i['geometry']['type'] == 'LineString':
        places['coordinates'] = [LineString(i['geometry']['coordinates']).centroid.x,
                                LineString(i['geometry']['coordinates']).centroid.y]
    else:
        places['coordinates'] = i['geometry']['coordinates']

    if 'name' in i['properties'].keys():
        places['name'] =  i['properties']['name']
    else:
        places['name'] =  'Benches'

    places['properties'] =  [{'subcategory' : 'benches',
                                    'distance_to_totem_1' : vincenty((places['coordinates'][1],places['coordinates'][0]),(totem_location_1_lat,
                                                                                      totem_location_1_lon)).meters,
                                    'distance_to_totem_2' : vincenty((places['coordinates'][1],places['coordinates'][0]),(totem_location_2_lat,
                                                                               totem_location_2_lon)).meters}]
    places_all.append(places)

## Gardens
for i in data_gardens['features']:
    places = {}
    places['category'] = 'tranquility'

    if i['geometry']['type'] == 'Polygon':
        places['coordinates'] = [Polygon(i['geometry']['coordinates'][0]).centroid.x,
                                Polygon(i['geometry']['coordinates'][0]).centroid.y]
    elif i['geometry']['type'] == 'LineString':
        places['coordinates'] = [LineString(i['geometry']['coordinates']).centroid.x,
                                LineString(i['geometry']['coordinates']).centroid.y]
    else:
        places['coordinates'] = i['geometry']['coordinates']

    if 'name' in i['properties'].keys():
        places['name'] =  i['properties']['name']
    else:
        places['name'] =  'Gardens'

    places['properties'] =  [{'subcategory' : 'gardens',
                                    'distance_to_totem_1' : vincenty((places['coordinates'][1],places['coordinates'][0]),(totem_location_1_lat,
                                                                                      totem_location_1_lon)).meters,
                                    'distance_to_totem_2' : vincenty((places['coordinates'][1],places['coordinates'][0]),(totem_location_2_lat,
                                                                               totem_location_2_lon)).meters}]
    places_all.append(places)

## Viewpoints
for i in data_viewpoints['features']:
    places = {}
    places['category'] = 'tranquility'

    if i['geometry']['type'] == 'Polygon':
        places['coordinates'] = [Polygon(i['geometry']['coordinates'][0]).centroid.x,
                                Polygon(i['geometry']['coordinates'][0]).centroid.y]
    elif i['geometry']['type'] == 'LineString':
        places['coordinates'] = [LineString(i['geometry']['coordinates']).centroid.x,
                                LineString(i['geometry']['coordinates']).centroid.y]
    else:
        places['coordinates'] = i['geometry']['coordinates']

    if 'name' in i['properties'].keys():
        places['name'] =  i['properties']['name']
    else:
        places['name'] =  'Viewpoint'

    places['properties'] =  [{'subcategory' : 'viewpoints',
                                    'distance_to_totem_1' : vincenty((places['coordinates'][1],places['coordinates'][0]),(totem_location_1_lat,
                                                                                      totem_location_1_lon)).meters,
                                    'distance_to_totem_2' : vincenty((places['coordinates'][1],places['coordinates'][0]),(totem_location_2_lat,
                                                                               totem_location_2_lon)).meters}]
    places_all.append(places)


## Museum
for i in data_museum['features']:
    places = {}
    places['category'] = 'culture'

    if i['geometry']['type'] == 'Polygon':
        places['coordinates'] = [Polygon(i['geometry']['coordinates'][0]).centroid.x,
                                Polygon(i['geometry']['coordinates'][0]).centroid.y]
    elif i['geometry']['type'] == 'LineString':
        places['coordinates'] = [LineString(i['geometry']['coordinates']).centroid.x,
                                LineString(i['geometry']['coordinates']).centroid.y]
    else:
        places['coordinates'] = i['geometry']['coordinates']

    if 'name' in i['properties'].keys():
        places['name'] =  i['properties']['name']
    else:
        places['name'] =  'Museum'

    places['properties'] =  [{'subcategory' : 'museum',
                                    'distance_to_totem_1' : vincenty((places['coordinates'][1],places['coordinates'][0]),(totem_location_1_lat,
                                                                                      totem_location_1_lon)).meters,
                                    'distance_to_totem_2' : vincenty((places['coordinates'][1],places['coordinates'][0]),(totem_location_2_lat,
                                                                               totem_location_2_lon)).meters}]
    places_all.append(places)



## Sculpture
for i in data_sculpture['features']:
    places = {}
    places['category'] = 'attractions'

    if i['geometry']['type'] == 'Polygon':
        places['coordinates'] = [Polygon(i['geometry']['coordinates'][0]).centroid.x,
                                Polygon(i['geometry']['coordinates'][0]).centroid.y]
    elif i['geometry']['type'] == 'LineString':
        places['coordinates'] = [LineString(i['geometry']['coordinates']).centroid.x,
                                LineString(i['geometry']['coordinates']).centroid.y]
    else:
        places['coordinates'] = i['geometry']['coordinates']

    if 'name' in i['properties'].keys():
        places['name'] =  i['properties']['name']
    else:
        places['name'] =  'Sculpture'

    places['properties'] =  [{'subcategory' : 'sculpture',
                                    'distance_to_totem_1' : vincenty((places['coordinates'][1],places['coordinates'][0]),(totem_location_1_lat,
                                                                                      totem_location_1_lon)).meters,
                                    'distance_to_totem_2' : vincenty((places['coordinates'][1],places['coordinates'][0]),(totem_location_2_lat,
                                                                               totem_location_2_lon)).meters}]
    places_all.append(places)

## Monument
for i in data_sculpture['features']:
    places = {}
    places['category'] = 'attractions'

    if i['geometry']['type'] == 'Polygon':
        places['coordinates'] = [Polygon(i['geometry']['coordinates'][0]).centroid.x,
                                Polygon(i['geometry']['coordinates'][0]).centroid.y]
    elif i['geometry']['type'] == 'LineString':
        places['coordinates'] = [LineString(i['geometry']['coordinates']).centroid.x,
                                LineString(i['geometry']['coordinates']).centroid.y]
    else:
        places['coordinates'] = i['geometry']['coordinates']

    if 'name' in i['properties'].keys():
        places['name'] =  i['properties']['name']
    else:
        places['name'] =  'Monument'

    places['properties'] =  [{'subcategory' : 'monument',
                                    'distance_to_totem_1' : vincenty((places['coordinates'][1],places['coordinates'][0]),(totem_location_1_lat,
                                                                                      totem_location_1_lon)).meters,
                                    'distance_to_totem_2' : vincenty((places['coordinates'][1],places['coordinates'][0]),(totem_location_2_lat,
                                                                               totem_location_2_lon)).meters}]
    places_all.append(places)

## Bridge
for i in data_bridge['features']:
    places = {}
    places['category'] = 'attractions'

    if i['geometry']['type'] == 'Polygon':
        places['coordinates'] = [Polygon(i['geometry']['coordinates'][0]).centroid.x,
                                Polygon(i['geometry']['coordinates'][0]).centroid.y]
    elif i['geometry']['type'] == 'LineString':
        places['coordinates'] = [LineString(i['geometry']['coordinates']).centroid.x,
                                LineString(i['geometry']['coordinates']).centroid.y]
    else:
        places['coordinates'] = i['geometry']['coordinates']

    if 'name' in i['properties'].keys():
        places['name'] =  i['properties']['name']
    else:
        places['name'] =  'Bridge'

    places['properties'] =  [{'subcategory' : 'bridge',
                                    'distance_to_totem_1' : vincenty((places['coordinates'][1],places['coordinates'][0]),(totem_location_1_lat,
                                                                                      totem_location_1_lon)).meters,
                                    'distance_to_totem_2' : vincenty((places['coordinates'][1],places['coordinates'][0]),(totem_location_2_lat,
                                                                               totem_location_2_lon)).meters}]
    places_all.append(places)


## Filter blank entries
places_all = filter(None, places_all)

## Filter corporations
places_all = filter(lambda d: 'Starbucks' not in d['name'], places_all)
places_all = filter(lambda d: 'Costa' not in d['name'], places_all)
places_all = filter(lambda d: 'Pret' not in d['name'], places_all)
places_all = filter(lambda d: 'Nero' not in d['name'], places_all)

## Saving cleaned data to a file
with open('places_all.json', 'w') as outfile:
    json.dump(places_all, outfile)
