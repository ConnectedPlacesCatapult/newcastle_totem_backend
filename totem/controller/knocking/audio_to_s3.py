import pyaudio
import boto3
import time
import json
from botocore.client import Config
from datetime import datetime
import math

def main():
    start_time = datetime.now()
    chunk = 1024
    FORMAT = pyaudio.paInt16
    CHANNELS = 1
    RATE = 44100
    threshold = 0.01 # controls the sensitivity of detection
    max_value = 0
   
    p = pyaudio.PyAudio()
    stream = p.open(format=FORMAT,input_device_index = 3,
                    channels=CHANNELS, 
                    rate=RATE, 
                    input=True,
                    output = True,
                    frames_per_buffer=chunk)

    time_track =  datetime.now()
    while True:
    	try:
    		print "Audio uploading initialised"
 		if (time_track - start_time).seconds > 60:
			data = stream.read(chunk)
			max_value =  get_rms(data)
			ACCESS_KEY_ID = 'AKIAINRS6Y72NCDYTV3Q'
			s3 = boto3.resource(
				's3',
	  			aws_access_key_id='AKIAINRS6Y72NCDYTV3Q',
	   			aws_secret_access_key='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',
	   			config=Config(signature_version='s3v4')
			)
			for obj in s3.Bucket('southside.tech.totem').objects.all():
				key = obj.key
	    			if key == 'rpiAudioRMS.json':  
	        			body = obj.get()['Body'].read()
	        			a = json.loads(body)
	        			a.append({u'objectRpiNoise': {u'noiseValue': max_value,
	          					u'timestamp': time.time()}})
	        			with open('rpiAudioRMS.json', 'w') as outfile:  
	            				json.dump(a, outfile)
					s3.Object('southside.tech.totem', 'rpiAudioRMS.json').put(Body = open('rpiAudioRMS.json'))
    	except Exception, e:
		print str(e)
		pass

def get_rms( block ):
    # RMS amplitude is defined as the square root of the 
    # mean over time of the square of the amplitude.
    # so we need to convert this string of bytes into 
    # a string of 16-bit samples...

    # we will get one short out for each 
    # two chars in the string.
    count = len(block)/2
    format = "%dh"%(count)
    shorts = struct.unpack( format, block )

    # iterate over the block.
    sum_squares = 0.0
    for sample in shorts:
        # sample is a signed short in +/- 32768. 
        # normalize it to 1.0
        n = sample * SHORT_NORMALIZE
        sum_squares += n*n

    return math.sqrt( sum_squares / count)

if __name__ == '__main__':
    main()
