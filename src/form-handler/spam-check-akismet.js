/*------------------------------------------------------------------------------
  Spam Check Akismet
  If enabled,
    a. minimally checks IP Address and User Agent
    b. checks fields defined as 'content' and 'other' based on config
------------------------------------------------------------------------------*/

/*-- Dependencies ------------------------------------------------------------*/
const { AkismetClient } = require('akismet-api/lib/akismet.js'); // had to hardcode path

/*-- Cloud Function ----------------------------------------------------------*/
const spamCheckAkismet = async (req, formTemplate, propsForSpamCheck, app) => {

  // Akismet credentials
  const key = app.spamFilterAkismet.key;
  const blog = app.appInfo.appUrl;
  const client = new AkismetClient({ key, blog })

  try {
    // Returns akismet props either as string or {}
    // ternary with reduce
    const akismetProps = (fieldGroup, accumulatorType) =>
      // if database contains fieldsAkismet and [fieldGroup] array
      (typeof formTemplate.fieldsAkismet !== 'undefined'
        && typeof formTemplate.fieldsAkismet[fieldGroup] !== 'undefined'
        && formTemplate.fieldsAkismet[fieldGroup].length > 0)
      // if true then reduce
      ? (formTemplate.fieldsAkismet[fieldGroup].reduce((a, field) => {
        // skip if field not found in propsForSpam...
        if (typeof propsForSpamCheck.template.data[field] === 'undefined') {
          return a
        }
        // accumulate as 'string' or {} based on accumulatorType
        if (typeof accumulatorType === 'string') {
          return a + propsForSpamCheck.template.data[field] + " ";
        } else if (accumulatorType.constructor === Object) {
          a[field] = propsForSpamCheck.template.data[field];
          return a;
        }
      }, accumulatorType))
      // if false then null
      : null;

      // Data to check for spam
    const dataToCheck = {
      //...req.ip && { ip: req.ip },
      ip: '76.106.197.174',
      ...req.headers['user-agent'] && { useragent: req.headers['user-agent'] },
      ...akismetProps('content', '') && { content: akismetProps('content', '') },
      ...akismetProps('other', {})
    }

    // Test if data is spam: a successful test returns boolean
    const isSpam = await client.checkSpam(dataToCheck);
    // return object since form-results props.set() expects {} entries
    return typeof isSpam === 'boolean' ?
      isSpam ? {spam: 'true'} : {spam: 'false'} :
      "Check failed"

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

module.exports = spamCheckAkismet;