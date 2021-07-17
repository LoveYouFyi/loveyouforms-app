/*------------------------------------------------------------------------------
  Spam Check
  If Akismet enabled...
  a. minimally checks IP Address and User Agent
  b. checks fields defined as 'content' and 'other' based on config
------------------------------------------------------------------------------*/

/*-- Dependencies ------------------------------------------------------------*/
const { AkismetClient } = require('akismet-api/lib/akismet.js'); // had to hardcode path

/*------------------------------------------------------------------------------
  Akismet Props:
  Returns 'string' or object {} to accommodate Akismet required data format
------------------------------------------------------------------------------*/
const akismetProps = (formTemplateData, propsData, fieldGroup, accumulator) => {

  // If database contains fieldsSpamCheck and [fieldGroup] array
  if (typeof formTemplateData.fieldsSpamCheck !== 'undefined'
    && typeof formTemplateData.fieldsSpamCheck[fieldGroup] !== 'undefined'
    && formTemplateData.fieldsSpamCheck[fieldGroup].length > 0) {

    // Then reduce to return aggregated fields based on accumulator type
    const props =
      formTemplateData.fieldsSpamCheck[fieldGroup].reduce((a, field) => {
        // skip if field not found
        if (typeof propsData.template.data[field] === 'undefined') {
          return a
        }
        // accumulate as 'string' or {} based on accumulator type
        if (typeof accumulator === 'string') {
          return a + propsData.template.data[field] + " ";
        } else if (accumulator.constructor === Object) {
          a[field] = propsData.template.data[field];
          return a;
        }
      }, accumulator);

    return props;

  } else {
     // if false then null
     return null;
  }
}

/*------------------------------------------------------------------------------
  Spam Check:
  Returns one of {spam: 'Check disabled '} {spam: 'true'} {spam: 'false'}
------------------------------------------------------------------------------*/
module.exports = async (req, app, globalApp, formTemplateData, propsData) => {
  try {

    // If spam filter akismet disabled then return object with prop
    if (globalApp.condition.spamFilterAkismet === 0
        || (globalApp.condition.spamFilterAkismet === 2
            && !app.condition.spamFilterAkismet)
    ) {
      return { spam: 'Check disabled' };
    }

    // Akismet credentials
    const key = app.service.spamFilterAkismet.key;
    const blog = app.appInfo.appUrl;
    const client = new AkismetClient({ key, blog });

    //////////////////////////////////////////////////////////////////////////////
    // Data to check for spam
    //////////////////////////////////////////////////////////////////////////////
    const dataContentString =
      akismetProps(formTemplateData, propsData, 'content', '');
    const dataOtherObject =
      akismetProps(formTemplateData, propsData, 'other', {});

    const dataToCheck = {
      // IP Address: Akismet requires req.ip value so if undefined set to null;
      // ...the conditional is needed because firebase emulator (dev environment)
      // does not provide req.ip so we prevent unacceptable undefined IP property
      ip: (typeof req.ip !== 'undefined' ? req.ip : null),
      // User Agent
      ...req.headers['user-agent'] && { useragent: req.headers['user-agent'] },
      // Content: expected as single string
      ...dataContentString && { content: dataContentString },
      // Other: expected as separate props
      ...dataOtherObject
    }

    // Test if data is spam: a successful test returns boolean
    const isSpam = await client.checkSpam(dataToCheck);
    // return object since form-results props.set() expects {} entries
    return (typeof isSpam === 'boolean')
      ? (isSpam ? { spam: 'true' } : { spam: 'false' })
      : "Check failed"

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
