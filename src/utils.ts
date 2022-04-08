export function formatPrice (input: any) {
  const inputNumber = Number(input)
  if (inputNumber > 99999) {
    return inputNumber.toFixed(0)
  } 
  if (inputNumber > 9999) {
    return inputNumber.toFixed(1)
  } 
  if (inputNumber > 999) {
    return inputNumber.toFixed(2)
  } 
  if (inputNumber > 99) {
    return inputNumber.toFixed(3)
  } 
  if (inputNumber > 9) {
    return inputNumber.toFixed(4)
  } 
  if (inputNumber > 1) {
    return inputNumber.toFixed(5)
  } 
  return inputNumber.toPrecision(6)
}