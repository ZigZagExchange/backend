// SPDX-License-Identifier: BUSL-1.1
import Joi from 'joi'

export const zksyncOrderSchema = Joi.object({
  accountId: Joi.number().integer().required(),
  recipient: Joi.string().required(),
  nonce: Joi.number().integer().required(),
  amount: Joi.string().required(),
  tokenSell: Joi.number().integer().required(),
  tokenBuy: Joi.number().integer().required(),
  validFrom: Joi.number().required(),
  validUntil: Joi.number()
    .min((Date.now() / 1000) | 0)
    .max(2000000000)
    .required(),
  ratio: Joi.array().items(Joi.string()).length(2).required(),
  signature: Joi.object().required().keys({
    pubKey: Joi.string().required(),
    signature: Joi.string().required(),
  }),
  ethSignature: Joi.any(),
})

export const StarkNetSchema = Joi.object({
  message_prefix: Joi.string().required(),
  domain_prefix: Joi.object({
    name: Joi.string().required(),
    version: Joi.string().required(),
    chain_id: Joi.string().required(),
  }),
  sender: Joi.string(),
  order: Joi.object({
    base_asset: Joi.string().required(),
    quote_asset: Joi.string().required(),
    side: Joi.string().required(),
    base_quantity: Joi.string().required(),
    price: Joi.object({
      numerator: Joi.string().required(),
      denominator: Joi.string().required(),
    }),
    expiration: Joi.string().required(),
  }),
  sig_r: Joi.string(),
  sig_s: Joi.string(),
})

export const EVMOrderSchema = Joi.object({
  user: Joi.string().required().messages({
    'string.base': `"user" should be a type of 'string'`,
    'string.hex': `"user" should be a hex string`,
    'any.required': `"user" is a required field`
  }),
  sellToken: Joi.string().required().messages({
    'string.base': `"sellToken" should be a type of 'string'`,
    'string.hex': `"sellToken" should be a hex string`,
    'any.required': `"sellToken" is a required field`
  }),
  buyToken: Joi.string().required().messages({
    'string.base': `"buyToken" should be a type of 'string'`,
    'string.hex': `"buyToken" should be a hex string`,
    'any.required': `"buyToken" is a required field`
  }),
  feeRecipientAddress: Joi.string().required().messages({
    'string.base': `"feeRecipientAddress" should be a type of 'string'`,
    'string.hex': `"feeRecipientAddress" should be a hex string`,
    'any.required': `"feeRecipientAddress" is a required field`
  }),
  relayerAddress: Joi.string().required().messages({
    'string.base': `"relayerAddress" should be a type of 'string'`,
    'string.hex': `"relayerAddress" should be a hex string`,
    'any.required': `"relayerAddress" is a required field`
  }),
  sellAmount: Joi.string().required().messages({
    'string.base': `"sellAmount" should be a type of 'string'`,
    'any.required': `"sellAmount" is a required field`
  }),
  buyAmount: Joi.string().required().messages({
    'string.base': `"buyAmount" should be a type of 'string'`,
    'any.required': `"buyAmount" is a required field`
  }),
  makerVolumeFee: Joi.string().required().messages({
    'string.base': `"makerVolumeFee" should be a type of 'string'`,
    'any.required': `"makerVolumeFee" is a required field`
  }),
  takerVolumeFee: Joi.string().required().messages({
    'string.base': `"takerVolumeFee" should be a type of 'string'`,
    'any.required': `"takerVolumeFee" is a required field`
  }),
  gasFee: Joi.string().required().messages({
    'string.base': `"gasFee" should be a type of 'string'`,
    'any.required': `"gasFee" is a required field`
  }),
  expirationTimeSeconds: Joi.string().required().messages({
    'string.base': `"expirationTimeSeconds" should be a type of 'string'`,
    'any.required': `"expirationTimeSeconds" is a required field`
  }),
  salt: Joi.string().required().messages({
    'string.base': `"salt" should be a type of 'string'`,
    'any.required': `"salt" is a required field`
  }),
  signature: Joi.string().required().messages({
    'string.base': `"signature" should be a type of 'string'`,
    'any.required': `"signature" is a required field`
  }),
})
