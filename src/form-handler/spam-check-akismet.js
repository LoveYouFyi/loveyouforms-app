/*------------------------------------------------------------------------------
  Spam Check Akismet
  If enabled,
    a. minimally checks IP Address and User Agent
    b. checks fields defined as 'content' and 'other' based on config
------------------------------------------------------------------------------*/

/*-- Cloud Function ----------------------------------------------------------*/
const { AkismetClient } = require('akismet-api/lib/akismet.js'); // had to hardcode path

const spamCheckAkismet = async (req, formTemplateRef, propsForSpamCheck, app, globalApp) => {
  // return object since result is added to form-results-data using props.set()
  const akismetResults = { spam: 'Check not enabled'}

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
        ...akismetProps('content')('') && { content: akismetProps('content')('') },
        ...akismetProps('other')({})
      }

      // Test if data is spam: a successful test returns boolean
      const isSpam = await client.checkSpam(dataToCheck);
      // if spam suspected
      if (typeof isSpam === 'boolean' && isSpam) {
        akismetResults.spam = 'true';
      }
      // if spam not suspected
      else if (typeof isSpam === 'boolean' && !isSpam) {
        akismetResults.spam = 'false';
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

  return akismetResults;

}

module.exports = spamCheckAkismet;