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

export const ZZMessageSchema = Joi.object({
  message_prefix: Joi.string().required(),
  domain_prefix: Joi.object({
    name: Joi.string().required(),
    version: Joi.string().required(),
    chain_id: Joi.string().required()
  }),
  sender: Joi.string(),
  order: Joi.object({
    base_asset: Joi.string().required(),
    quote_asset: Joi.string().required(),
    side: Joi.string().required(),
    base_quantity: Joi.string().required(),
    priceRatio: Joi.array().items(Joi.string()).length(2).required(),
    expiration: Joi.string().required()    
  }),
  sig_r: Joi.string(),
  sig_s: Joi.string()
})
