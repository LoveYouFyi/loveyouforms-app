// SECTION Requirements

// Cloud Functions for Firebase SDK to create Cloud Functions and setup triggers.
const functions = require('firebase-functions');
// Firebase Admin SDK to access the Firebase/Firestore Realtime Database.
const admin = require('firebase-admin');
/** [START] CREDENTIALS ****/
const serviceAccount = require('./service-account.json'); // download from firebase console
admin.initializeApp({ // initialize firebase admin with credentials
  credential: admin.credential.cert(serviceAccount), // So functions can connect to database
  databaseURL: 'https://loveyou-forms.firebaseio.com' // Needed if using FireBase database (not FireStore)
});
/** [END] CREDENTIALS ****/
const db = admin.firestore(); // FireStore database reference
// Timestamps: required for adding server-timestamps to any database docs
const FieldValue = require('firebase-admin').firestore.FieldValue; // Timestamp here
const timestampSettings = { timestampsInSnapshots: true}; // Define timestamp settings
db.settings(timestampSettings); // Apply timestamp settings to database settings
const moment = require('moment-timezone'); // Timestamp formats and timezones
// Google APIs
const { google } = require('googleapis');
const sheets = google.sheets('v4'); // Google Sheets
const jwtClient = new google.auth.JWT({ // JWT Authentication (for google sheets)
  email: serviceAccount.client_email, // [**** CREDENTIALS ****]
  key: serviceAccount.private_key, // [**** CREDENTIALS ****]
  scopes: ['https://www.googleapis.com/auth/spreadsheets'] // read and write sheets
});

// !SECTION

// SECTION Helper Functions

const logErrorInfo = error => ({
  Error: 'Description and source line:',
  description: error,
  break: '**************************************************************',
  Logger: ('Error reported by log enty at:'),
  info: (new Error()),
});

const responseErrorBasic = string => ({
  message: {
    error: string
  }
});

// !SECTION

// Terminate HTTP functions with res.redirect(), res.send(), or res.end().
// https://firebase.google.com/docs/functions/terminate-functions


// ANCHOR Form Handler
exports.formHandler = functions.https.onRequest(async (req, res) => {

  try {
    
    /**
     * Global config
     */
    const globals = await db.collection('global').get();
    const globalConfig = globals.docs.reduce((object, doc) => { 
      object[doc.id] = doc.data();
      return object;
    }, {});

    /**
     *  If form not submitted by authorized app then stop processing cloud function
     */

//    console.log("req.method $$$$$$$$$$$ ", req.method);
    //console.log("typeof req.body $$$$$$$$$$$$$$$$$ ", typeof req.body);
    //console.log("req.body $$$$$$$$$$$$$$$$$ ", req.body);
    
    let reqBody = JSON.parse(req.body);

    console.log("typeof reqbody, reqbody $$$$$$$$$$$$$$$$ ", typeof reqBody, reqBody);
    //console.log("reqbody $$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$ ", reqBody);
   
    const app = await db.collection('app').doc(reqBody.appKey.value).get();

    // App key validation: if exists continue with cors validation
    if (app) {
      // CORS validation: stop cloud function if CORS check does not pass
      if (globalConfig.cors.bypass) {
        // allow * so localhost (or any source) recieves response
        res.set('Access-Control-Allow-Origin', '*');
      } else {
        // restrict to url requests that match the app
        res.set('Access-Control-Allow-Origin', app.data().appInfo.appUrl);
        // end processing if url does not match (req.headers.origin = url)
        if (req.headers.origin !== app.data().appInfo.appUrl) { 
          console.info(new Error('Origin Url does not match app url.'));
          return res.end();
        } 
      }
    } else {
      console.info(new Error('App Key does not exist.'));
      res.end();
    }


    /**
     * Compile fields (app and form props) labeled 'props' because they are handled 
     * as object entries; sanitize; add to structured object; submit to databasea
     */

    let appKey = app.id;
    let appInfoObject = app.data().appInfo;

    let { ...form } = reqBody;

//    console.log("formElements $$$$$$$$$$$$$$$$$ ", form);
    //console.log("reqbody.email $$$$$$$$$$$$$$$$$ ", reqBody.email);

    let templateName = form.templateName.value
      ? form.templateName.value : globalConfig.defaultTemplate.name;

    let urlRedirect = form.urlRedirect.value
      ? form.urlRedirect.value : globalConfig.urlRedirect.default;

    // Compile props and add formElements last to allow override of global props
    let props = { appKey, ...appInfoObject, templateName, urlRedirect, ...form }
    console.log("props $$$$$$$$$$$$$$$$$ ", props);
    /** [START] Data Validation & Prep ****************************************/
    // field contains maxLength values for props sanitize
    let fields = await db.collection('field').get();
    // Whitelist contains props allowed to be added to formSubmission template.data
    let whitelistTemplateData = await db.collection('formTemplate').doc(templateName).get();

    let propsPrime = (() => { 
      
      let sanitize = (value, maxLength) => 
        value.toString().trim().substr(0, maxLength);

      // compare database fields with form-submitted props and build object
      let getProps = fields.docs.reduce((a, doc) => {
        let maxLength = doc.data().maxLength;
        // if form-submitted 'props' found in 'fields' add to object {}
        if (props[doc.id]) {
          // sanitize prop
          let sanitized;
          if (appInfoObject.hasOwnProperty(doc.id)) {
           sanitized = sanitize(props[doc.id], maxLength);
          } else {
            sanitized = sanitize(props[doc.id].value, maxLength);
          }
          // add to object {}
          a[doc.id] = sanitized;
          // if 'prop' in templateData whitelist, add to object templateData 
          if (whitelistTemplateData.data().templateData.includes(doc.id)) {
            // add to object {} prop: templateData object
            a.templateData[doc.id] = sanitized; 
          } 
        }

        return a
      }, { templateData: {} });

      return {
        get: () => {
          return getProps;
        }
      }
    })();
    /** [END] Data Validation & Prep ******************************************/

    let propsGet = ({ templateData, urlRedirect, ...key } = propsPrime.get()) => ({
      data: {
        appKey: key.appKey, 
        createdDateTime: FieldValue.serverTimestamp(), 
        from: key.appFrom, 
        toUids: [ key.appKey ], 
        replyTo: templateData.email,
        webformId: key.webformId, 
        template: { 
          name: key.templateName, 
          data: templateData
        }
      },
      urlRedirect: urlRedirect
    });

    // For serverTimestamp to work must first create new doc key then 'set' data
    const newKey = db.collection("formSubmission").doc();
    // update the new-key-record using 'set' which works for existing doc
    newKey.set(propsGet().data)

    /**
     * Response
     */

    return res.status(200).send({
      // return response (even if empty) so client can finish AJAX success
      data: {
        redirect: propsGet().urlRedirect
      }
    });

  } catch(error) {

    console.error(logErrorInfo(error));

    return res.status(500).send(responseErrorBasic('Error: Application error.'));

  } // end catch

});


// ANCHOR - Firestore To Sheets [New sheet, header, and data row]
exports.firestoreToSheets = functions.firestore.document('formSubmission/{formId}')
  .onCreate(async (snapshot, context) => {

  try {

    /**
    * Prepare row data values and sheet header
    */

    // Form Submission: values from Snapshot.data()
    let { appKey, createdDateTime, template: { data: { ...templateData }, 
      name: templateName  }, webformId } = snapshot.data();

    // Template: two sort-ordered arrays of strings
    // sheetHeader array is sorted according to desired sheets visual
    // templateData array is sorted to match the order of sheetHeader
    let formTemplate = await db.collection('formTemplate').doc(templateName).get();

    // Header fields for sheet requires nested array of strings [ [ 'Date', 'Time', etc ] ]
    let sheetHeader = [( formTemplate.data().sheetHeader )]; 

    /** [START] Row Data: Sort & Merge ****************************************/
    // Strings to 'prop: value' objects so data to be merged has uniform format
    // timezone 'tz' string defined by momentjs.com/timezone: https://github.com/moment/moment-timezone/blob/develop/data/packed/latest.json
    const dateTime = createdDateTime.toDate(); // toDate() is firebase method
    let createdDate = moment(dateTime).tz(templateData.appTimeZone).format('L');
    let createdTime = moment(dateTime).tz(templateData.appTimeZone).format('h:mm A z');
    // Reduce array formTemplate.templateData, this returns an object that 
    // is sort-ordered to matach the sheetHeader fields.
    let templateDataSorted = formTemplate.data().templateData.reduce((a, c) => {
      templateData[c] ? a[c] = templateData[c] : a[c] = "";
      return a
    }, {});
    // Merge objects in sort-order and return only values
    // Data-row for sheet requires nested array of strings [ [ 'John Smith', etc ] ]
    let sheetDataRow = [( Object.values({ createdDate, createdTime, 
      webformId, ...templateDataSorted }) )];
    /** [END] Row Data: Sort & Merge ******************************************/


    /**
    * Prepare to insert data-row into app spreadsheet
    */

    // Get app spreadsheetId and sheetId (one spreadsheet with multiple sheets possible)
    let app = await db.collection('app').doc(appKey).get();
    let spreadsheetId = app.data().spreadsheet.id; // one spreadsheet per app
    let sheetId = app.data().spreadsheet.sheetId[templateName]; // multiple possible sheets

    // Authorize with google sheets
    await jwtClient.authorize();

    // Row: Add to sheet (header or data)
    const rangeHeader =  `${templateName}!A1`; // e.g. "contactDefault!A1"
    const rangeData =  `${templateName}!A2`; // e.g. "contactDefault!A2"

    const addRow = range => values => ({
      auth: jwtClient,
      spreadsheetId: spreadsheetId,
      ...range && { range }, // e.g. "contactDefault!A2"
      valueInputOption: "RAW",
      requestBody: {
        ...values && { values }
      }
    });
    
    // Row: Blank insert (sheetId argument: existing vs new sheet)
    const blankRowInsertAfterHeader = sheetId => ({
      auth: jwtClient,
      spreadsheetId: spreadsheetId,
      resource: {
        requests: [
          {
            "insertDimension": {
              "range": {
                "sheetId": sheetId,
                "dimension": "ROWS",
                "startIndex": 1,
                "endIndex": 2
              },
              "inheritFromBefore": false
            }
          }
        ]
      }
    });

    /**
    * Insert row data into sheet that matches template name
    */

    // Check if sheet name exists for data insert
    const sheetObjectRequest = () => ({
      auth: jwtClient,
      spreadsheetId: spreadsheetId,
      includeGridData: false
    });
    let sheetDetails = await sheets.spreadsheets.get(sheetObjectRequest());
    let sheetNameExists = sheetDetails.data.sheets.find(sheet => {
      // if sheet name exists returns sheet 'properties' object, else is undefined
      return sheet.properties.title === templateName;
    });

    // If sheet name exists, insert data
    // Else, create new sheet + insert header + insert data
    if (sheetNameExists) {
      // Insert into spreadsheet a blank row and the new data row
      await sheets.spreadsheets.batchUpdate(blankRowInsertAfterHeader(sheetId));
      await sheets.spreadsheets.values.update(addRow(rangeData)(sheetDataRow));

    } else {
      // Create new sheet, insert heder and new row data
      
      // Request object for adding sheet to existing spreadsheet
      const addSheet = () => ({
        auth: jwtClient,
        spreadsheetId: spreadsheetId,
        resource: {
          requests: [
            {
              "addSheet": {
                "properties": {
                  "title": templateName,
                  "index": 0,
                  "gridProperties": {
                    "rowCount": 1000,
                    "columnCount": 26
                  },
                }
              } 
            }
          ]
        }
      });

      // Add new sheet:
      // 'addSheet' request object returns new sheet properties
      // Get new sheetId and add to app spreadsheet info
      // newSheet returns 'data' object with properties:
      //   prop: spreadsheetId
      //   prop: replies[0].addSheet.properties (sheetId, title, index, sheetType, gridProperties { rowCount, columnCount }
      let newSheet = await sheets.spreadsheets.batchUpdate(addSheet());
      // Map 'replies' array to get sheetId
      let newSheetId = sheet => {
        let newSheet = {};
        sheet.data.replies.map(reply => newSheet.addSheet = reply.addSheet);
        return newSheet.addSheet.properties.sheetId;
      };

      // Add new sheetId to app spreadsheet info
      db.collection('app').doc(appKey).update({
          ['spreadsheet.sheetId.' + templateName]: newSheetId(newSheet)
      });

      // New Sheet Actions: add row header then row data
      await sheets.spreadsheets.values.update(addRow(rangeHeader)(sheetHeader));
      await sheets.spreadsheets.values.update(addRow(rangeData)(sheetDataRow));

    } // end 'else' add new sheet

  } catch(error) {
    
    console.error(logErrorInfo(error));

  } // end catch

});


// ANCHOR Firebase to Sheets [Basic 2 Column List]
exports.firebaseToSheets = functions.database.ref("/Form")
  .onUpdate(async change => {

  let data = change.after.val();
  console.log("data ################ ", data);
  // Convert JSON to Array following structure below
  //
  //[
  //  ['COL-A', 'COL-B'],
  //  ['COL-A', 'COL-B']
  //]
  //
  let itemArray = [];
  let valueArray = [];
  Object.keys(data).forEach((key, index) => {
    itemArray.push(key);
    itemArray.push(data[key]);
    console.log("itemArray ############################# ", itemArray);
    valueArray[index] = itemArray;
    itemArray = [];
  });

  let maxRange = valueArray.length + 1;

  // Do authorization
  await jwtClient.authorize();
  console.log("valueArray ############################# ", valueArray) 

  // Create Google Sheets request
  let request = {
    auth: jwtClient,
    spreadsheetId: "1nOzYKj0Gr1zJPsZv-GhF00hUAJ2sTsCosMk4edJJ9nU",
    range: "Firebase!A2:B" + maxRange,
    valueInputOption: "RAW",
    requestBody: {
      values: valueArray
    }
  };
  
  // Update data to Google Sheets
  await sheets.spreadsheets.values.update(request, {});
});

