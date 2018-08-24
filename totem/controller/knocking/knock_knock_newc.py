#!/usr/bin/python
import pyaudio
from time import sleep
from datetime import datetime
import subprocess
import struct
import math
import boto3
import time
import json
from botocore.client import Config

knock = 0
wait = 3.5
#flag = 0


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
        n = sample * (1.0/32768.0)
        sum_squares += n*n

    return math.sqrt( sum_squares / count)


def record_audio():
    global knock
    global flag
#    global wait

#    sleep(wait)
    if knock >= 3 and knock < 6:
        print "Three knock: recording initialised"
        stream.stop_stream()
        stream.close()
	cmdplay = 'mpg321 Bleep.mp3'
	subprocess.call(cmdplay, shell=True)
        filename = datetime.now().strftime('%Y%m%d_%H%M%S') + '.wav'
        cmdrec = 'arecord --device=plughw:1,0 -d 60  %s' %filename
        subprocess.call(cmdrec, shell=True)
        cmdmp3 = 'lame -V3 %s' %filename
        subprocess.call(cmdmp3, shell=True)
        cmdrm = 'rm %s' %filename
        subprocess.call(cmdrm, shell=True)

        knock = 0
#        flag = 0
        main()
    else:
        knock = 0
#        flag = 0
        main()

def upload(max_value):
    s3 = boto3.resource(
        's3',
        aws_access_key_id='AKIAJG3WFE3ORCBQD7DA',
        aws_secret_access_key='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',
        config=Config(signature_version='s3v4')
    )

    for obj in s3.Bucket('newcastle.tech.totem').objects.all():
        key = obj.key
        if key == 'rpiAudioRMS.json':
            body = obj.get()['Body'].read()
            a = json.loads(body)
            a.append({u'objectRpiNoise': {u'noiseValue': ("%.2f" % round(max_value,2)),
                    u'timestamp': time.time()}})
            with open('rpiAudioRMS.json', 'w') as outfile:
                    json.dump(a, outfile)
            s3.Object('newcastle.tech.totem', 'rpiAudioRMS.json').put(Body = open('rpiAudioRMS.json'))
            print "here", max_value
            stream.stop_stream()
            stream.close()
            main()

def main():
    global knock
#    global flag
    global stream
    start_time = datetime.now()
    start_time2 = datetime.now()
    chunk = 1024
    FORMAT = pyaudio.paInt16
    CHANNELS = 1
    RATE = 44100
    max_value = 0

    p = pyaudio.PyAudio()
    stream = p.open(format=FORMAT,#input_device_index = 3,
                    channels=CHANNELS,
                    rate=RATE,
                    input=True,
                    #output = True,
                    frames_per_buffer=chunk)
    print "Knock detection initialized"
    while True:
        try:
            data = stream.read(chunk)
            max_value =  get_rms(data)
            time_track = datetime.now()
            if (time_track - start_time).seconds > 120:
                print "saving"
                upload(max_value)
                start_time = datetime.now()

            if (time_track-start_time2).seconds < 120:
#                print "listening",
#                print max_value
                if max_value > 0.3:
                    knock += 1
                    start_time2 = datetime.now()
                    print "Knocked: ", knock, max_value
                if knock >= 3:
                    record_audio()
#                    flag = 0
                    start_time2 = datetime.now()
                    knock = 0

        except IOError as ex:
            print str(ex)
            if ex[1] != pyaudio.paInputOverflowed:
                raise
                data = '\x00' * chunk
                print data
                continue
            else:
                pass




if __name__ == '__main__':
    main()
