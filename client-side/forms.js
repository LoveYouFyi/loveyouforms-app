/**
 * AJAX Form Submissions (Vanilla JS)
 */

// Form listeners 'submit'
const listenFormSubmit = ajaxRequest => {
  document.querySelectorAll('form').forEach(form => {
    form.addEventListener('submit', ajaxRequest, false);
  });
}

// Messages (client-side)
const message = (form, action, delay, message) => {
  let parent = form.parentNode; // get form parent element
  let elements =  parent.querySelectorAll('[love-message="form-message"]'); // select child elements
  // set elements innerHTML
  elements.forEach(e => {
    e.innerHTML = message;
  });
  // show/hide elements
  setTimeout(function(){
    elements.forEach(e => {
      e.style.display = action;
    });
  }, delay); 
}

// Radio listeners and check/uncheck
const radiosChecked = () => {
  // check/uncheck
  let radioCheck = event => {
    // uncheck all
    let grandParent = event.target.parentNode.parentNode; // get form parent element
    grandParent.querySelectorAll('[type="radio"]').forEach(e => {
      e.removeAttribute('checked');
    });
    // check selected
    event.target.setAttribute('checked', "true");
  };
  // Listeners (after above since need access to radioCheck)
  document.querySelectorAll('[type="radio"]').forEach(e => {
    e.addEventListener('click', radioCheck);
  });
}

// Reset form values
const formReset = form => {
  let parent = form.parentNode; // get form parent element
  /**
   * Inputs (except specified), selects, and textareas: set innerHTML to empty string
   */
  let elements =  parent.querySelectorAll('input:not([type="hidden"]):not([type="radio"]), select, textarea'); 
  elements.forEach(e => {
    e.value = '';
  });
  /**
   * Radios reset: select first radio of group
   */
  let radios =  parent.querySelectorAll('[love-wrapper="radio"] [type=radio]'); 
  let elementName = "";
  radios.forEach(e => {
    e.removeAttribute('checked');
    if (elementName !== e.name) {
      e.setAttribute('checked', "true");
      e.click(); // Only way to visually show the first item as clicked;
    }
    elementName = e.name;
  });
}

// Serialize form for submit (longform because babel does not convert Object.values w/ 'reduce' for ie11)
const serializeForm = form => {
	// Setup our serialized data
	let serialized = {};
	// Loop through each field in the form
	for (let i = 0; i < form.elements.length; i++) {
		let field = form.elements[i];
    // Don't serialize fields without a name, submits, buttons, file and reset inputs, and disabled fields
    if (!field.name 
      || field.disabled 
      || field.type === 'file' 
      || field.type === 'reset' 
      || field.type === 'submit' 
      || field.type === 'button'
    ) continue; // 'continue 'jumps over' one iteration in the loop, here, it skips the element if not of this type
		// Convert field data to a query string
		if ((field.type !== 'checkbox' && field.type !== 'radio') || field.checked) {
      serialized[field.name] = { type: field.type, value: field.value };
    }
  }
  serialized = JSON.stringify(serialized);
  return serialized;
};

// Ajax request
const ajaxRequest = event => {
  event.preventDefault(); // stop submit so input values do not get cleared before being able to act on them
  /**
   * Form data
   */
  let form = event.target;
  let formUrlAction = form.querySelector('[name=urlAction]').value;
  let formData = serializeForm(form);

  /**
   * Ajax Request Object
   */
  let xhr = new XMLHttpRequest();
  // initiate request = onloadstart
  xhr.onloadstart = function() {
    message(form, 'block', 0, 'Processing...'); 
  }
  // error sending request (not error returned with response)
  xhr.onerror = function () {
    message(form, 'block', 0, 'Error: Sorry, please try again or contact us by phone?'); 
  }
  // successful response = onload (any response from application including error)
  xhr.onload = function(event) {
    let res = event.target.response; // responseType set to json
    // error handling
    // ECMAScript 2020 check if property defined with '?' res?.message?.error because if undefined will error
    if (res?.error?.message) { 
      message(form, 'block', res.error.message.timeout, res.error.message.text);
      console.error(res.error.message.text);
    }
    // if urlRedirect
    else if (res?.data?.redirect && res.data.redirect !== 'false') { // compare 'false' as string b/c not proper boolean
      formReset(form);
      window.location.href = res.data.redirect;
    } 
    // if no urlRedirect
    else {
      formReset(form);
      message(form, 'none', res.data.message.timeout, res.data.message.text);
    } 
  }
  // Send Request
  xhr.open('POST', formUrlAction);
  xhr.setRequestHeader('Content-Type', 'text/plain');
  xhr.responseType = 'json';
  xhr.send(formData);
}

document.onload = listenFormSubmit(ajaxRequest);
document.onload = radiosChecked();