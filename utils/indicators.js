import { RSI, EMA, ATR } from 'technicalindicators';

export function calculateIndicators(data) {
  return {
    rsi: RSI.calculate({ values: data.close, period: 14 }).slice(-1)[0],
    ema: EMA.calculate({ values: data.close, period: 50 }).slice(-1)[0],
    atr: ATR.calculate({
      high: data.high,
      low: data.low,
      close: data.close,
      period: 14
    }).slice(-1)[0],
    volume: data.volume.slice(-1)[0]
  };
}