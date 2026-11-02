"use strict";

// Presentation only: validate in memory, then open the static reader.
const form = document.querySelector("#access-form");
const nameInput = document.querySelector("#access-name");
const emailInput = document.querySelector("#access-email");
const submitButton = document.querySelector("#continue-button");
const message = document.querySelector("#form-message");

function fieldError(input, errorId, text) {
  document.querySelector(errorId).textContent = text;
  if (text) input.setAttribute("aria-invalid", "true");
  else input.removeAttribute("aria-invalid");
}

for (const [input, errorId] of [[nameInput, "#name-error"], [emailInput, "#email-error"]]) {
  input.addEventListener("input", () => {
    fieldError(input, errorId, "");
    message.textContent = "";
  });
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (submitButton.disabled) return;
  const name = nameInput.value.trim();
  const email = emailInput.value.trim();
  const validName = name.length > 0 && name.length <= 120 && !/[\u0000-\u001f\u007f<>]/u.test(name);
  const validEmail = email.length <= 254 && emailInput.validity.valid && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(email) && !/[\u0000-\u001f\u007f]/u.test(email);
  fieldError(nameInput, "#name-error", validName ? "" : "Informe um nome com até 120 caracteres.");
  fieldError(emailInput, "#email-error", validEmail ? "" : "Informe um endereço de e-mail válido.");
  if (!validName || !validEmail) {
    (validName ? emailInput : nameInput).focus();
    return;
  }
  submitButton.disabled = true;
  nameInput.value = "";
  emailInput.value = "";
  window.location.assign("reader.html");
});

// The generated HTML starts disabled and has no named form fields.
submitButton.disabled = false;
