# Fetches content from the Google Sheet contianing taglines and descriptions for sensors

import gspread
import json
from oauth2client.service_account import ServiceAccountCredentials

# ID for "Uban Data Observatory Sensor Messages" sheet
gs_sheet_id = "14juakEmoRi9Mu4XFGr7Wx8QvGOaLxhR1ZavP2crOpV0"

gs_scope = ['https://spreadsheets.google.com/feeds',
        'https://www.googleapis.com/auth/drive']
gs_creds = ServiceAccountCredentials.from_json_keyfile_name('../client_secret.json', gs_scope)
gs_client = gspread.authorize(gs_creds)

gs_doc = gs_client.open_by_key(gs_sheet_id)

gs_descriptions = gs_doc.worksheet("descriptions")
gs_taglines = gs_doc.worksheet("taglines")

# Construct JSON object
details_out = {}

for i in range(2, 10):
    col = gs_descriptions.col_values(i)

    temp_details = {}
    temp_details["key"] = col[1]
    temp_details["label"] = col[2]
    temp_details["description"] = col[3]

    temp_details["taglines"] = []

    col_tags = gs_taglines.col_values(i)
    for j in range(1, len(col_tags)):
        if col_tags[j] == "":
            break
        temp_details["taglines"].append(col_tags[j])

    details_out[col[0]] = temp_details

# Save to sensor_details.json
with open("sensor_details.json", "wb") as outfile:
    json.dump(details_out, outfile)
