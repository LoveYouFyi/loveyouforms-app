/*------------------------------------------------------------------------------
  App Validate
  Returns object: { app, globalApp, messages }
  Check if cors authorized app, and form submit enabled
  Stop processing if checks fail
------------------------------------------------------------------------------*/

const appValidate = async (req, res, db, formSubmission) => {
  let messages;
  let globalApp;
  const appRef = await db.collection('app').doc(formSubmission.appKey).get();
  const app = appRef.data();

  // If app exists continue with global and app condition checks
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

  return ({
    app,
    globalApp,
    messages
  })

}

module.exports = appValidate;