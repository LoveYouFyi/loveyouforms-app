/*------------------------------------------------------------------------------
  Firestore-to-Sheets Trigger Cloud Function
  Listens for new 'submitForm' collection docs and adds data to google sheets.
  If required, creates new sheet(tab) and row header.
------------------------------------------------------------------------------*/

/*-- Dependencies ------------------------------------------------------------*/
const { logErrorInfo, sortObjectsAsc, objectValuesByKey } =
  require("./../utility");
const getFormDataAndSheetHeaderRows = require('./form-data-and-sheet-header-rows');
const processGoogleSheetSync = require('./google-sheet-sync');

/*------------------------------------------------------------------------------
  App: used in multiple child files so get once here
------------------------------------------------------------------------------*/
const getApp = async (db, appKey) => {
  const gotApp = await db.collection('app').doc(appKey).get();
  return gotApp.data();
}

/*------------------------------------------------------------------------------
  Export Firestore To Sheets Function
------------------------------------------------------------------------------*/
module.exports = ({ admin }) => async (snapshot, context) => {

  const db = admin.firestore();
  // Form Results
  const { appKey, createdDateTime, template: { data: { ...templateData },
    name: templateName  } } = snapshot.data();

  try {

    const app = await getApp(db, appKey);

    // Form Data and Sheet Header Rows
    const formDataAndSheetHeaderRows = await getFormDataAndSheetHeaderRows(snapshot, db, app);
    const sheetHeaderRow = formDataAndSheetHeaderRows.sheetHeaderRowSorted;
    const formDataRow = formDataAndSheetHeaderRows.formDataRowSorted;

    ////////////////////////////////////////////////////////////////////////////
    // Process Google Sheets Sync
    ////////////////////////////////////////////////////////////////////////////
    await processGoogleSheetSync(snapshot, db, app, sheetHeaderRow, formDataRow);

  } catch(error) {

    console.error(logErrorInfo(error));

  }

}
