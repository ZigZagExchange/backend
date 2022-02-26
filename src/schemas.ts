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
