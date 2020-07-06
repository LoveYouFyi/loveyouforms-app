/*------------------------------------------------------------------------------
  App Validate
  Processes validations, and if all pass returns object with app, globalApp,
  and messages
------------------------------------------------------------------------------*/

/*-- Cloud Function ----------------------------------------------------------*/

/*------------------------------------------------------------------------------
  Messages:
  Returns global or app-specific messages based on config settings
------------------------------------------------------------------------------*/
const messagesAppVsGlobal = (app, globalApp) => {
  // global boolean 0/false, 1/true, or '2' bypass global & use app boolean
  return (
    (globalApp.condition.messageGlobal === 1
      || (globalApp.condition.messageGlobal === 2
          && !!app.condition.messageGlobal)
    ) ? globalApp.message
      : app.message
  )
}

/*------------------------------------------------------------------------------
  App Validate:
  Returns object { app, globalApp, messages }
  Check if cors authorized app, and form submit enabled
  Stop processing if checks fail
------------------------------------------------------------------------------*/
const appValidate = async (req, res, db, formSubmission) => {
  // App
  const gotApp = await db.collection('app').doc(formSubmission.appKey).get();
  const app = gotApp.data();

  // App Check: if app does not exist then stop processing
  if (!app) {
    console.warn('App Key does not exist.');
    // no error message response sent because submit not from approved app
    return res.end();
  }

  // Global App
  const gotGlobalApp = await db.collection('global').doc('app').get();
  const globalApp = gotGlobalApp.data();

  // Messages
  // App-specific or Global App messages based on config
  const messages = messagesAppVsGlobal(app, globalApp);

  //////////////////////////////////////////////////////////////////////////////
  // CORS Validation
  // Stop cloud function if check does not pass
  // Global boolean 0/false, 1/true, or '2' bypass global to use app boolean
  //////////////////////////////////////////////////////////////////////////////
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

  //////////////////////////////////////////////////////////////////////////////
  // Form Submit Enabled: throw error if submitForm disabled
  // global boolean 0/false, 1/true, or '2' bypass global to use app boolean
  //////////////////////////////////////////////////////////////////////////////
  if (globalApp.condition.submitForm === 0
      || (globalApp.condition.submitForm === 2
          && !app.condition.submitForm)
    ) {
    console.warn(`Form submit disabled for app "${app.appInfo.appName}"`);
    // return error response because submit is from approved app
    throw (messages.error.text);
  }

  //////////////////////////////////////////////////////////////////////////////
  // Return
  //////////////////////////////////////////////////////////////////////////////
  return ({
    app,
    globalApp,
    messages
  })

}

module.exports = appValidate;