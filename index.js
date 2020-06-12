/*------------------------------------------------------------------------------
  Node.js Modules
  Modules and configuration for use by Firestore cloud functions
------------------------------------------------------------------------------*/

/*-- Dependencies for all cloud functions ------------------------------------*/
// Service Account for Firebase: Resolve path for service-account file, then 
// require it. Fyi: you must manually download file using Firebase console. 
const path = require('path');
const serviceAccount = require(path.join(__dirname, "../../", "service-account.json")); 
// Firebase Functions SDK: to create Cloud Functions and setup triggers
const functions = require('firebase-functions');
// Database Credentials: so cloud functions can authenticate with the database
// Firebase Admin SDK: to interact with the Firestore (or firebase) database 
const admin = require('firebase-admin');
admin.initializeApp({ // initialize firebase admin with credentials
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore(); // FireStore database reference
/*-- Dependencies formHandler cloud function ---------------------------------*/
// Timestamps: for adding server-timestamps to database docs
const FieldValue = admin.firestore.FieldValue; // Timestamp here
const timestampSettings = { timestampsInSnapshots: true }; // Define timestamp settings
db.settings(timestampSettings); // Apply timestamp settings to database settings
// Akismet Spam Filter 
const { AkismetClient } = require('akismet-api/lib/akismet.js'); // had to hardcode path
/*-- Dependencies firestoreToSheets cloud function ---------------------------*/
const moment = require('moment-timezone'); // Timestamp formats and timezones
const { google } = require('googleapis'); // Google API 
const sheets = google.sheets('v4'); // Google Sheets
const jwtClient = new google.auth.JWT({ // JWT Authentication (for google sheets)
  email: serviceAccount.client_email, // <--- CREDENTIALS
  key: serviceAccount.private_key, // <--- CREDENTIALS
  scopes: ['https://www.googleapis.com/auth/spreadsheets'] // read and write sheets
});


/*------------------------------------------------------------------------------
  Utility Functions
  For use by cloud functions
------------------------------------------------------------------------------*/

const logErrorInfo = error => ({
  Error: 'Description and source line:',
  description: error,
  break: '**************************************************************',
  Logger: ('Error reported by log enty at:'),
  info: (new Error()),
});

// argument 'propKey' value must be of type 'string' or 'number'
const sortObjectsAsc = (array, propKey) => array.sort((a, b) => {
  const value = val => typeof val === 'string' ? val.toUpperCase() : val;
  const valueA = value(a[propKey]);
  const valueB = value(b[propKey]);
  
  if (valueA > valueB ) return 1;
  if (valueA < valueB) return -1;
  return 0; // if equal
});

const objectValuesByKey = (array, propKey) => array.reduce((a, c) => {
  a.push(c[propKey]);
  return a;
}, []);


/*------------------------------------------------------------------------------
  Form-Handler HTTP Cloud Function
  Receives data sent by form submission and creates database entry
  Terminate HTTP cloud functions with res.redirect(), res.send(), or res.end()
------------------------------------------------------------------------------*/

module.exports.formHandler = functions.https.onRequest(async (req, res) => {

  let messages; // declared here so catch has access to config messages 

  try {

    ////////////////////////////////////////////////////////////////////////////
    // Validate: request content-type; cors authorized app; form submit disabled
    // Stop processing if checks fail
    ////////////////////////////////////////////////////////////////////////////
   
    // Request Content-Type: stop processing if content type is not 'text/plain'
    const contentType = req.headers['content-type'];
    if (typeof contentType === 'undefined' 
        || contentType.toLowerCase() !== 'text/plain') {
      console.warn(`Request header 'content-type' must be 'text/plain'`);
      return res.end();
    }
    
    const formResults = JSON.parse(req.body); // parse req.body json-text-string

    const appRef = await db.collection('app').doc(formResults.appKey).get();
    const app = appRef.data();
    let globalApp; // declared here for akismet

    // App key: if exists continue with global and app condition checks
    if (app) {
      const globalAppRef = await db.collection('global').doc('app').get();
      globalApp = globalAppRef.data();
      // Messages: use global or app-specific messages
      // global boolean 0/false, 1/true, or '2' bypass global & use app boolean
      if (globalApp.condition.messageGlobal === 1
          || (globalApp.condition.messageGlobal === 2 
              && !!app.condition.messageGlobal)
        ) {
        messages = globalApp.message;
      } else {
        messages = app.message;
      }
      // CORS validation: stop cloud function if check does not pass
      // global boolean 0/false, 1/true, or '2' bypass global to use app boolean
      if (globalApp.condition.corsBypass === 0
          || (globalApp.condition.corsBypass === 2 
              && !app.condition.corsBypass)
        ) {
        // url requests restricted to match the app
        res.setHeader('Access-Control-Allow-Origin', app.appInfo.appUrl);
        // end processing if app url does not match req.headers.origin url
        if (req.headers.origin !== app.appInfo.appUrl) { 
          console.warn('CORS Access Control: Origin Url does not match App Url.');
          // no error response sent because request not from approved app
          return res.end();
        }
      } else {
        // allow all so localhost (or any source) can submit requests
        res.setHeader('Access-Control-Allow-Origin', '*');
      }
      // Form Submit Enabled: stop cloud function if submitForm disabled
      // global boolean 0/false, 1/true, or '2' bypass global to use app boolean
      if (globalApp.condition.submitForm === 0
          || (globalApp.condition.submitForm === 2 
              && !app.condition.submitForm)
        ) {
        console.warn(`Form submit disabled for app "${app.appInfo.appName}"`);
        // return error response because submit is from approved app
        throw (messages.error.text);
      }
    } else {
      console.warn('App Key does not exist.');
      // no error response sent because submit not from approved app
      return res.end();
    }
    
    ////////////////////////////////////////////////////////////////////////////
    // Props/Fields
    // Compile database and form fields to be handled as object entries, and
    // add to structured object 
    ////////////////////////////////////////////////////////////////////////////

    const appKey = app.id;
    const appInfo = app.appInfo;

    //
    // Form Field Defaults: select from db all default fields
    // Return Object of docs
    //
    const formFieldsDefaultRef = await db.collection('formField')
      .where('default', '==', true).get();

    const formFieldsDefault = formFieldsDefaultRef.docs.reduce((a, doc) => {
      a[doc.id] = doc.data().value;
      return a;
    }, {});
    
    //
    // Props All: consolidate props and fields last-in overwrites previous 
    //
    const propsAll = { appKey, ...formFieldsDefault, ...formResults, ...appInfo };

    ////////////////////////////////////////////////////////////////////////////
    // Props Allowed Entries: reduce to allowed props
    //
    // Remove the fields not used for database or code actions to:
    // 1) prevent database errors due to querying docs using disallowed values
    //    e.g. if html <input> had name="__anything__"
    //    doc limits: https://firebase.google.com/docs/firestore/quotas#limits
    // 2) only include fields used for database or code actions
    //
    // Props Whitelist: compiled from database
    // Database Schema
    //   formField/'all required' --> formFieldsRequired
    //   formTemplate/'templateName'/fields --> formTemplateFields
    //   app/'appKey'/appInfo.*props --> appInfo

    //
    // Form Fields Required: fields required for cloud function to work
    // Return Array of field names
    //
    const formFieldsRequiredRef = await db.collection('formField')
      .where('required', '==', true).get();

    const formFieldsRequired = formFieldsRequiredRef.docs.reduce((a, doc) => {
      a.push(doc.id);
      return a;
    }, []);

    //
    // Form Template Fields:
    // Array of field for submitForm/*/template.data used by 'trigger email' extension
    //
    const formTemplateRef = await db.collection('formTemplate')
      .doc(propsAll.templateName).get();

    const formTemplateFieldsSorted = objectValuesByKey(
      sortObjectsAsc(formTemplateRef.data().fields, 'position'), 'id');

    // Props Whitelist:
    // Array of prop keys allowed for database or code actions last-in overwrites previous
    const propsWhitelist = [ ...formFieldsRequired, ...formTemplateFieldsSorted, 
      ...Object.keys(appInfo) 
    ];

    //
    // Props Allowed Entries: entries used for database or code actions
    // Return Object
    //
    const propsAllowedEntries = Object.entries(propsAll).reduce((a, [key, value]) => {
      if (propsWhitelist.includes(key)) {
        a[key] = value; 
      } 
      return a;
    }, {});
    //
    // [END] Props Allowed Entries: reduce to allowed props
    ////////////////////////////////////////////////////////////////////////////

    ////////////////////////////////////////////////////////////////////////////
    // Props Set & Get
    //
    const props = (() => {

      const trim = value => value.toString().trim();
      const props =  { toUids: '', templateData: {} }

      // compare database fields with form-submitted props and build object
      const setProps = propsToParse => 
        Object.entries(propsToParse).forEach(([prop, data]) => {
          data = trim(data);
          props[prop] = data;
          // toUids: appKey value unless if spam flagged is [ akismet spam message ]
          if (prop === 'appKey') {
            props.toUids = data;
          } else if (prop === 'toUidsSpamOverride') {
            props.toUids = data;
          }
          // Form Template Fields: Whitelist check [START]
          if (formTemplateFieldsSorted.includes(prop)) {
            props.templateData[prop] = data;
          }
          // Form Template Fields: Whitelist check [END]
        });

      const getProps = ({ templateData, urlRedirect = false, ...key } = props) => ({
        data: {
          appKey: key.appKey, 
          createdDateTime: FieldValue.serverTimestamp(), 
          from: key.appFrom,
          ...key.spam && { spam: key.spam }, // only defined if akismet enabled
          toUids: [ key.toUids ], 
          replyTo: templateData.email,
          template: { 
            name: key.templateName, 
            data: templateData
          }
        },
        urlRedirect: urlRedirect
      });
 
      return {
        set: props => {
          setProps(props);
        },
        get: () => {
          return getProps();
        }
      };
    })();
    // Set allowed props
    props.set(propsAllowedEntries);
    //
    // [END] Props Set & Get
    ////////////////////////////////////////////////////////////////////////////


    ////////////////////////////////////////////////////////////////////////////
    // Akismet Spam Filter 
    // If enabled: 
    //  1) Checks if spam
    //     a. minimally checks IP Address and User Agent 
    //     b. checks fields defined as 'content' and 'other' based on config
    //  2) Sets props
    //     a. spam 
    //     b. toUidsSpamOverride (if spam, string overrides UID to prevent email)
    //
    let akismetEnabled = false;
    if (globalApp.condition.spamFilterAkismet === 1
        || (globalApp.condition.spamFilterAkismet === 2 
            && !!app.condition.spamFilterAkismet)
    ) { 
      akismetEnabled = true;
    }

    if (akismetEnabled) {
      // Akismet credentials
      const key = app.spamFilterAkismet.key;
      const blog = app.appInfo.appUrl;
      const client = new AkismetClient({ key, blog })

      try {
        // Returns akismet props either as string or {}
        // ternary with reduce
        const akismetProps = fieldGroup => accumulatorType =>
          // if database contains fieldsAkismet and [fieldGroup] array 
          ( typeof formTemplateRef.data().fieldsAkismet !== 'undefined'
            && typeof formTemplateRef.data().fieldsAkismet[fieldGroup] !== 'undefined'
            && formTemplateRef.data().fieldsAkismet[fieldGroup].length > 0)
          // if true then reduce
          ? (formTemplateRef.data().fieldsAkismet[fieldGroup].reduce((a, field) => {
            // skip if field not found in props.get()...
            if (typeof props.get().data.template.data[field] === 'undefined') { 
              return a 
            }
            // accumulate as 'string' or {} based on accumulatorType 
            if (typeof accumulatorType === 'string') {
              return a + props.get().data.template.data[field] + " ";
            } else if (accumulatorType.constructor === Object) {
              a[field] = props.get().data.template.data[field];
              return a;
            }
          }, accumulatorType))
          // if false then null
          : null;

        // Data to check for spam
        const testData = {
          ...req.ip && { ip: req.ip },
          ...req.headers['user-agent'] && { useragent: req.headers['user-agent'] },
          ...akismetProps('content')('') && { content: akismetProps('content')('') },
          ...akismetProps('other')({})
        }

        // Test if data is spam: a successful test returns boolean
        const isSpam = await client.checkSpam(testData);
        // if spam suspected
        if (typeof isSpam === 'boolean' && isSpam) {
          props.set({spam: 'true' });
          props.set({toUidsSpamOverride: "SPAM_SUSPECTED_DO_NOT_EMAIL" });
        } 
        // if spam not suspected
        else if (typeof isSpam === 'boolean' && !isSpam) {
          props.set({spam: 'false' });
        }

      } catch(err) {

        // Validate API Key
        const isValid = await client.verifyKey();
        if (isValid) {
          console.info('Akismet: API key is valid');
        } else if (!isValid) {
          console.warn('Akismet: Invalid API key');
        }

        // if api key valid: error is likely network failure of client.checkSpam()
        console.error("Akismet ", err);

      }

    }
    //
    // [END] Akismet Spam Filter
    ////////////////////////////////////////////////////////////////////////////


    ////////////////////////////////////////////////////////////////////////////
    // Database Entry: add form submission to database
    ////////////////////////////////////////////////////////////////////////////

    // For serverTimestamp to work must first create new doc key then 'set' data
    const newKeyRef = db.collection('submitForm').doc();
    // update the new-key-record using 'set' which works for existing doc
    newKeyRef.set(props.get().data);


    ////////////////////////////////////////////////////////////////////////////
    // Response to request
    ////////////////////////////////////////////////////////////////////////////

    // return response object (even if empty) so client can finish AJAX success
    return res.status(200).send({
      data: {
        redirect: props.get().urlRedirect,
        message: messages.success
      }
    });

  } catch(error) {
    
    console.error(logErrorInfo(error));

    return res.status(500).send({
      error: {
        message: messages.error
      }
    });

  }

});


/*------------------------------------------------------------------------------
  Firestore-to-Sheets Trigger Cloud Function
  Listens for new 'submitForm' collection docs and adds data to google sheets.
  If required, creates new sheet(tab) and row header.
------------------------------------------------------------------------------*/

module.exports.firestoreToSheets = functions.firestore.document('submitForm/{formId}')
  .onCreate(async (snapshot, context) => {

  try {

    ////////////////////////////////////////////////////////////////////////////
    // Prepare row data values and sheet header
    ////////////////////////////////////////////////////////////////////////////

    // Form Submission: values from Snapshot.data()
    const { appKey, createdDateTime, template: { data: { ...templateData }, 
      name: templateName  } } = snapshot.data();

    // App Doc
    const appRef = await db.collection('app').doc(appKey).get();
    const app = appRef.data();
 
    // Template Field Ids and Header Row Sheet Columns
    // Database needs to have Fields Ids and Header Columns sorted to match
    // templateData array is sorted to match the order of headerRowSheet
    const formTemplateRef = await db.collection('formTemplate').doc(templateName).get();
    const formTemplate = formTemplateRef.data();

    // Fields Ids Sorted: required for sorting templateData so data row that is sent 
    // to sheets will be sorted in the same order as the sheet's column header
    const formTemplateFieldsIdsSorted = objectValuesByKey(
      sortObjectsAsc(formTemplate.fields, "position"), "id");
    
    // Fields Sheet Headers Sorted: required for spreadsheet column headers when 
    // adding a new sheet to a spreadsheet
    // Sheets requires a nested array of strings [ [ 'Date', 'Time', etc ] ]
    const formTemplateFieldsSheetHeadersSorted = [
      [
        'Date', 'Time', 
        ...objectValuesByKey(
          sortObjectsAsc(formTemplate.fields, "position"), "sheetHeader")
      ]
    ];

    ////////////////////////////////////////////////////////////////////////////
    // Row Data: Sort and Merge (data row to be sent to sheets)
    //

    // timezone 'tz' string defined by momentjs.com/timezone:
    // https://github.com/moment/moment-timezone/blob/develop/data/packed/latest.json
    const dateTime = createdDateTime.toDate(); // toDate() is firebase method
    const createdDate = moment(dateTime).tz(app.appInfo.appTimeZone).format('L');
    const createdTime = moment(dateTime).tz(app.appInfo.appTimeZone).format('h:mm A z');
    
    // Template Data Sorted: returns an object that contains the new 
    // formSubmit record's data sort-ordered to match formTemplate fields positions
    const templateDataSorted = formTemplateFieldsIdsSorted.reduce((a, fieldName) => {
      // if fieldName data not exist set empty string since config sort order requires it
      templateData[fieldName] ? a[fieldName] = templateData[fieldName] : a[fieldName] = "";
      return a
    }, {});

    // Merge objects in sort-order and return only values
    // Data-row for sheet requires nested array of strings [ [ 'John Smith', etc ] ]
    const sheetDataRow = [(
      Object.values({
        createdDate,
        createdTime,
        ...templateDataSorted
      })
    )];
    //
    // [END] Row Data: Sort and Merge
    ////////////////////////////////////////////////////////////////////////////


    ////////////////////////////////////////////////////////////////////////////
    // Prepare to insert data-row into app spreadsheet
    ////////////////////////////////////////////////////////////////////////////

    // Get app spreadsheetId and sheetId(s)
    const spreadsheetId = app.spreadsheet.id; // one spreadsheet per app
    const sheetId = app.spreadsheet.sheetId[templateName]; // multiple possible sheets

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


    ////////////////////////////////////////////////////////////////////////////
    // Insert row data into sheet that matches template name
    ////////////////////////////////////////////////////////////////////////////

    // Check if sheet name exists for data insert
    const sheetObjectRequest = () => ({
      auth: jwtClient,
      spreadsheetId: spreadsheetId,
      includeGridData: false
    });
    const sheetDetails = await sheets.spreadsheets.get(sheetObjectRequest());
    const sheetNameExists = sheetDetails.data.sheets.find(sheet => {
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
      //   prop: replies[0].addSheet.properties (
      //     sheetId, title, index, sheetType, gridProperties { rowCount, columnCount } )
      const newSheet = await sheets.spreadsheets.batchUpdate(addSheet());
      // Map 'replies' array to get sheetId
      const newSheetId = sheet => {
        const newSheet = {};
        sheet.data.replies.map(reply => newSheet.addSheet = reply.addSheet);
        return newSheet.addSheet.properties.sheetId;
      };

      // Add new sheetId to app spreadsheet info
      db.collection('app').doc(appKey).update({
        ['spreadsheet.sheetId.' + templateName]: newSheetId(newSheet)
      });

      // New Sheet Actions: add row header then row data
      await sheets.spreadsheets.values.update(
        addRow(rangeHeader)(formTemplateFieldsSheetHeadersSorted)
      );
      await sheets.spreadsheets.values.update(addRow(rangeData)(sheetDataRow));

    } // end 'else' add new sheet

  } catch(error) {
    
    console.error(logErrorInfo(error));

  }

});


/*------------------------------------------------------------------------------
  Doc-Schema Trigger Cloud Functions
  When a new 'doc' is created this adds default fields/schema to it
  Parameters: 'col' is collection type and 'schema' is from 'global' collection
------------------------------------------------------------------------------*/

const schemaDefault = (col, schema) => functions.firestore.document(`${col}/{id}`)
  .onCreate(async (snapshot, context) => {

  try {

    // Get Default Schema
    const schemaRef = await db.collection('global').doc(schema).get();
    const schemaData = schemaRef.data();

    // Update new doc with default schema
    const appRef = db.collection(col).doc(context.params.id);
    appRef.set(schemaData); // update record with 'set' which is for existing doc

    return schemaData;

  } catch(error) {
    
    console.error(logErrorInfo(error));

  }

});

// Default schema functions for 'app' and 'formTemplate' collections
module.exports.schemaApp = schemaDefault('app', 'schemaApp'),
module.exports.schemaFormTemplate = schemaDefault('formTemplate', 'schemaFormTemplate')

// Jest Test
module.exports.onCreate = functions.firestore.document('TestCollection/{docId}')
  .onCreate(async (snapshot)=> {

  const data = snapshot.data()
  const docId = snapshot.id

  const copyRef = db.collection('Copies').doc(docId)
  await copyRef.set(data)

});

