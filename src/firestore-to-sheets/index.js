/*------------------------------------------------------------------------------
  Firestore-to-Sheets Trigger Cloud Function
  Listens for new 'submitForm' collection docs and adds data to google sheets.
  If required, creates new sheet(tab) and row header.
------------------------------------------------------------------------------*/

/*-- Dependencies ------------------------------------------------------------*/
const { logErrorInfo, sortObjectsAsc, objectValuesByKey } =
  require("./../utility");
// Sheets with Credentials
// service-account credentials: manually download file using Firebase console;
// credentials are used by cloud function to authenticate with Google Sheets API
const serviceAccount = require('./../../../../service-account.json');
const { google } = require('googleapis'); // Google API
const jwtClient = new google.auth.JWT({ // JWT Authentication (for google sheets)
  email: serviceAccount.client_email, // <--- CREDENTIALS
  key: serviceAccount.private_key, // <--- CREDENTIALS
  scopes: ['https://www.googleapis.com/auth/spreadsheets'] // read and write sheets
});
const sheets = google.sheets('v4'); // Google Sheets
const api = { jwtClient, sheets  };

const getFormDataAndSheetHeaderRows = require('./form-data-and-sheet-header-rows');

/*------------------------------------------------------------------------------
  Export Firestore To Sheets Function
------------------------------------------------------------------------------*/
module.exports = ({ admin }) => async (snapshot, context) => {

  const db = admin.firestore();
  // Form Results
  const { appKey, createdDateTime, template: { data: { ...templateData },
    name: templateName  } } = snapshot.data();

  try {

    ////////////////////////////////////////////////////////////////////////////
    // Prepare data row values and sheet header
    ////////////////////////////////////////////////////////////////////////////
    const formDataAndSheetHeaderRows = await getFormDataAndSheetHeaderRows(db, snapshot);
    const headerRow = formDataAndSheetHeaderRows.sheetHeaderRowSorted;
    const dataRow = formDataAndSheetHeaderRows.formDataRowSorted;

    // App Data
    const appRef = await db.collection('app').doc(appKey).get();
    const app = appRef.data();

    ////////////////////////////////////////////////////////////////////////////
    // Prepare to insert data-row into app spreadsheet
    ////////////////////////////////////////////////////////////////////////////

    // Get app spreadsheetId and sheetId(s)
    const spreadsheetId = app.service.googleSheets.spreadsheetId; // one spreadsheet per app
    const sheetId = app.service.googleSheets.sheetId[templateName]; // multiple possible sheets

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
      await sheets.spreadsheets.values.update(addRow(rangeData)(dataRow));

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
        addRow(rangeHeader)(headerRow)
      );
      await sheets.spreadsheets.values.update(addRow(rangeData)(dataRow));

    } // end 'else' add new sheet

  } catch(error) {

    console.error(logErrorInfo(error));

  }

}
