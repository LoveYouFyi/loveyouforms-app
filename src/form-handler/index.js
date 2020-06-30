/*------------------------------------------------------------------------------
  Form-Handler HTTP Cloud Function
  Receives data sent by form submission and creates database entry
  Terminate HTTP cloud functions with res.redirect(), res.send(), or res.end()
------------------------------------------------------------------------------*/

/*-- Dependencies ------------------------------------------------------------*/
const path = require('path');
const { logErrorInfo } =
  require(path.join(__dirname, "../utility"));

/*-- Cloud Function ----------------------------------------------------------*/
const appValidateRequest = require('./app-validate-request');
const formFieldsData = require('./form-fields-data');

module.exports = ({ admin }) => async (req, res) => {
  const db = admin.firestore();
  let messages; // declared here so catch has access to config messages
  // Stop processing if content type is undefined or not 'text/plain'
  if (typeof req.headers['content-type'] === 'undefined'
    || req.headers['content-type'].toLowerCase() !== 'text/plain') {
    console.warn(`Request header 'content-type' must be 'text/plain'`);
    res.end();
  }

  // Form results as object
  const formResults = JSON.parse(req.body); // parse req.body json-text-string

  try {

    const validRequest = await appValidateRequest(req, res, db, formResults);
    const app = validRequest.app;
    const globalApp = validRequest.globalApp; // declared here for akismet
    messages = validRequest.messages;

    //console.log("app $$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$ ", app);
    //console.log("globalApp $$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$ ", globalApp);
    //console.log("messages $$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$ ", messages);

    const dataResults = await formFieldsData(req, admin, db, formResults, app, globalApp);
    console.log("data $$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$ ", dataResults);
    ////////////////////////////////////////////////////////////////////////////
    // Database Entry: add form submission to database
    ////////////////////////////////////////////////////////////////////////////

    // For serverTimestamp to work must first create new doc key then 'set' data
    const newKeyRef = db.collection('submitForm').doc();
    // update the new-key-record using 'set' which works for existing doc
    newKeyRef.set(dataResults);


    ////////////////////////////////////////////////////////////////////////////
    // Response to request
    ////////////////////////////////////////////////////////////////////////////

    // return response object (even if empty) so client can finish AJAX success
    return res.status(200).send({
      data: {
        redirect: dataResults.urlRedirect,
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

}
