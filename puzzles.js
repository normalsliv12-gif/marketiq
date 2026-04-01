// ============================================================
//  MARKETIQ — Realistic Puzzle Data with Charts
// ============================================================

const DAILY_PUZZLES = [
    {
        id: 1,
        title: "Breakout at Resistance",
        chartData: [
            {time:"2024-03-01",open:49.80,high:50.20,low:49.50,close:50.10},
            {time:"2024-03-04",open:50.15,high:50.60,low:49.90,close:50.40},
            {time:"2024-03-05",open:50.40,high:51.10,low:50.20,close:50.95},
            {time:"2024-03-06",open:51.00,high:51.80,low:50.70,close:51.60},
            {time:"2024-03-07",open:51.65,high:52.50,low:51.30,close:52.20},
            {time:"2024-03-08",open:52.25,high:52.55,low:51.40,close:51.70},
            {time:"2024-03-11",open:51.65,high:51.90,low:51.10,close:51.50},
            {time:"2024-03-12",open:51.55,high:52.00,low:51.20,close:51.85},
            {time:"2024-03-13",open:51.90,high:52.30,low:51.65,close:52.15},
            {time:"2024-03-14",open:52.20,high:52.50,low:51.85,close:52.10},
            {time:"2024-03-15",open:52.05,high:52.25,low:51.60,close:51.80},
            {time:"2024-03-18",open:51.75,high:52.10,low:51.40,close:51.95},
            {time:"2024-03-19",open:52.00,high:52.35,low:51.75,close:52.20},
            {time:"2024-03-20",open:52.25,high:52.50,low:52.00,close:52.40},
        ],
        context: "Stock XYZ consolidating in $50–$52.50 range for 3 weeks. Volume declining. Today testing upper resistance $52.50 for third time. Market neutral. 50-day MA at $49.80.",
        timeframe: "Daily Chart · 3-Month View",
        question: "What would you do?",
        options: [
            {id:"A",text:"Enter long immediately at $52.40",quality:"risky"},
            {id:"B",text:"Wait for confirmed breakout with volume above $53",quality:"optimal"},
            {id:"C",text:"Short at resistance expecting rejection",quality:"poor"},
            {id:"D",text:"Set buy limit at $51 — pullback entry",quality:"good"}
        ],
        explanation:{
            optimal:"Confirmed breakout with volume validates the move. Patience reduces false breakout risk.",
            good:"Pullback entry = better risk/reward. Risk is missing the move if no pullback.",
            risky:"Entering before confirmation = anticipation, not reaction. Risk/reward unfavorable.",
            poor:"Triple-tested resistance weakens. Shorting into uptrend = high risk."
        }
    },
    {
        id:2,
        title:"Earnings Gap Analysis",
        chartData:[
            {time:"2024-02-20",open:70.50,high:71.20,low:70.10,close:70.90},
            {time:"2024-02-21",open:70.95,high:71.50,low:70.60,close:71.30},
            {time:"2024-02-22",open:71.25,high:72.00,low:71.00,close:71.80},
            {time:"2024-02-23",open:71.85,high:72.20,low:71.40,close:71.95},
            {time:"2024-02-26",open:72.00,high:78.20,low:71.90,close:77.50},
            {time:"2024-02-27",open:77.50,high:77.80,low:76.10,close:76.50},
        ],
        context:"Stock ABC beat earnings 12%. Gapped up 8% ($72→$78). Now at $76.50, 30min post-open. Declining volume. Market flat. Sector peers +1-2%.",
        timeframe:"Daily Chart (Gap Day)",
        question:"What's your move?",
        options:[
            {id:"A",text:"Buy at $76.50 — earnings beat justifies it",quality:"poor"},
            {id:"B",text:"Watch and wait — too volatile",quality:"good"},
            {id:"C",text:"Short — gap will fill to $72",quality:"risky"},
            {id:"D",text:"Identify $75 support, buy if holds",quality:"optimal"}
        ],
        explanation:{
            optimal:"50% gap fill at $75 = key level. Buying structure > chasing.",
            good:"Patience is professional. Not trading is valid.",
            poor:"Buying pullback without support = catching full gap fill.",
            risky:"Shorting fundamental strength = low probability."
        }
    },
    {
        id:3,
        title:"Ascending Triangle Breakout",
        chartData:[
            {time:"2024-03-01",open:100,high:103,low:99,close:102},
            {time:"2024-03-04",open:102,high:104,low:101,close:103},
            {time:"2024-03-05",open:103,high:105,low:102,close:104},
            {time:"2024-03-06",open:104,high:105,low:103,close:104.5},
            {time:"2024-03-07",open:104.5,high:105,low:104,close:104.8},
            {time:"2024-03-08",open:104.8,high:105,low:104.5,close:104.9},
            {time:"2024-03-11",open:105,high:108,low:104.8,close:107},
        ],
        context:"Ascending triangle with repeated resistance at 105. Last candle shows strong momentum closing near highs.",
        timeframe:"Daily Chart",
        question:"What is the most logical decision?",
        options:[
            {id:"A",text:"Buy on breakout above 105 with volume",quality:"optimal"},
            {id:"B",text:"Wait for pullback to 102",quality:"good"},
            {id:"C",text:"Short at resistance",quality:"poor"},
            {id:"D",text:"Do nothing, pattern unclear",quality:"risky"}
        ],
        explanation:{
            optimal:"Triangle breakout with strong close = bullish continuation. Confirmation reduces fakeout risk.",
            good:"Pullback improves risk/reward but risks missing continuation.",
            risky:"Pattern is clear — inaction wastes edge.",
            poor:"Shorting breakout momentum contradicts pattern."
        }
    },
    {
        id:4,
        title:"Liquidity Sweep & Reversal",
        chartData:[
            {time:"2024-02-01",open:200,high:205,low:198,close:204},
            {time:"2024-02-02",open:204,high:206,low:202,close:205},
            {time:"2024-02-05",open:205,high:207,low:203,close:206},
            {time:"2024-02-06",open:206,high:208,low:204,close:207},
            {time:"2024-02-07",open:207,high:209,low:205,close:208},
            {time:"2024-02-08",open:208,high:212,low:204,close:205},
            {time:"2024-02-09",open:205,high:206,low:200,close:201},
        ],
        context:"Equal highs near 208-209. Price aggressively broke above 210 then reversed strongly with bearish close.",
        timeframe:"4H Chart",
        question:"What is the most logical interpretation?",
        options:[
            {id:"A",text:"Bullish breakout continuation",quality:"poor"},
            {id:"B",text:"Liquidity sweep followed by reversal",quality:"optimal"},
            {id:"C",text:"Random volatility",quality:"risky"},
            {id:"D",text:"Strong support forming at 210",quality:"poor"}
        ],
        explanation:{
            optimal:"Equal highs attracted breakout traders. Sharp rejection = stop-hunt liquidity grab + distribution.",
            risky:"Structure clearly shows engineered liquidity sweep, not randomness.",
            poor:"Continuation failed due to strong bearish close."
        }
    },
    {
        id:5,
        title:"Downtrend Reversal Signal",
        chartData:[
            {time:"2024-01-02",open:43,high:44,low:41.5,close:42},
            {time:"2024-01-03",open:42,high:42.5,low:39.5,close:40},
            {time:"2024-01-04",open:40,high:41,low:37,close:38},
            {time:"2024-01-05",open:38,high:38.5,low:35,close:36},
            {time:"2024-01-08",open:36,high:37,low:33,close:34},
            {time:"2024-01-09",open:34,high:35,low:31,close:32},
            {time:"2024-01-10",open:32,high:32.5,low:29,close:30},
            {time:"2024-01-11",open:30,high:31,low:27.5,close:28.5},
            {time:"2024-01-12",open:28.5,high:29,low:26,close:28},
        ],
        context:"Stock DEF down 35% in 2 months. Today: hammer candlestick with long lower wick on 1.8x volume at $28 support. RSI=32. No news.",
        timeframe:"Daily Chart · 6-Month View",
        question:"What's your strategy?",
        options:[
            {id:"A",text:"Enter full position — hammer + RSI oversold",quality:"risky"},
            {id:"B",text:"Wait for higher high/higher low confirmation",quality:"optimal"},
            {id:"C",text:"Ignore — one candle never reverses trend",quality:"poor"},
            {id:"D",text:"Small starter, add if strength continues",quality:"good"}
        ],
        explanation:{
            optimal:"Structural confirmation (first higher high) is textbook reversal approach. Hammer = hypothesis, confirmation = proof.",
            good:"Scaling with starter + rules = excellent risk management.",
            risky:"Full size on single candle in strong downtrend = premature.",
            poor:"Dismissing meaningful signal at support with volume is overly rigid."
        }
    }
];

const THRILL_PUZZLES=[
    {
        id:"t1",
        title:"Flash Crash — No News",
        chartData:[
            {time:"2024-03-15T09:30:00",open:150,high:150.5,low:149.8,close:150.2},
            {time:"2024-03-15T09:31:00",open:150.2,high:150.3,low:149.9,close:150.1},
            {time:"2024-03-15T09:32:00",open:150.1,high:150.2,low:123,close:123.5},
        ],
        context:"Large-cap stock drops 18% in 90 seconds on 15x volume. No news. Circuit breaker triggered. Halted 5min. Decide for when trading resumes.",
        timeframe:"1-Min Chart · Real-Time",
        question:"When trading resumes, you will:",
        options:[
            {id:"A",text:"Buy aggressively — likely algo glitch",quality:"optimal"},
            {id:"B",text:"Wait 5min after resumption to observe",quality:"good"},
            {id:"C",text:"Short — momentum is negative",quality:"poor"},
            {id:"D",text:"Do nothing — uncertainty too high",quality:"risky"}
        ],
        explanation:{
            optimal:"Flash crashes on no news = high-probability snap-back. Buying panic with no catalyst is contrarian optimal.",
            good:"Waiting 5min is prudent. Miss bounce but reduce 'real event' risk.",
            poor:"Chasing momentum down on no-news crash = retail trap.",
            risky:"Inaction wastes high-probability opportunity."
        }
    },
    {
        id:"t2",
        title:"VIX Spike — Volatility Surge",
        chartData:[
            {time:"2024-02-10",open:100,high:101,low:99.5,close:100.5},
            {time:"2024-02-13",open:100.5,high:102,low:100,close:101.5},
            {time:"2024-02-14",open:101.5,high:110,low:101,close:108},
            {time:"2024-02-15",open:108,high:108.5,low:98,close:98},
        ],
        context:"VIX spiked 14→31 in 15min. S&P down 2.8%. Your tech position (entry $100, peak $108) now $98. Extreme put buying. No catalyst identified.",
        timeframe:"Real-Time",
        question:"Immediate action:",
        options:[
            {id:"A",text:"Hold — overreaction, still profitable long-term",quality:"risky"},
            {id:"B",text:"Sell 50% to manage risk, reassess",quality:"optimal"},
            {id:"C",text:"Add to position — buying opportunity",quality:"poor"},
            {id:"D",text:"Exit full position immediately",quality:"good"}
        ],
        explanation:{
            optimal:"50% sale preserves gains, retains upside, reduces risk. Balanced pro response.",
            good:"Full exit protects capital. Conservative but defensible.",
            risky:"Holding through unidentified VIX spike = assuming you know more than market.",
            poor:"Adding in extreme vol without catalyst = portfolio-destroying mistake."
        }
    },
    {
        id:"t3",
        title:"Fed Emergency Announcement",
        chartData:[
            {time:"2024-03-18",open:450,high:452,low:448,close:450},
            {time:"2024-03-19",open:450,high:464,low:449,close:463},
        ],
        context:"Fed unscheduled release: emergency 50bp rate cut. Futures surge 3.2% in 4min. You're 70% cash. Move already priced in significantly.",
        timeframe:"Live Market",
        question:"You immediately:",
        options:[
            {id:"A",text:"Deploy 40-50% cash into broad ETFs now",quality:"optimal"},
            {id:"B",text:"Wait for spike to fade, buy pullback",quality:"good"},
            {id:"C",text:"Go all-in — Fed support is one-way",quality:"poor"},
            {id:"D",text:"Stay cash — already priced in",quality:"risky"}
        ],
        explanation:{
            optimal:"40-50% deployment = measured + decisive. Fed cuts drive sustained rallies. Keep dry powder.",
            good:"Waiting for pullback is sound. Risk is missing leg if no retrace.",
            poor:"All-in on news spikes ignores 'sell the news' possibility.",
            risky:"Emergency cuts signal policy shift. Complete inaction with 70% cash is excessive caution."
        }
    }
];

const RATING_CHANGES={optimal:15,good:8,risky:3,poor:-10};
const THRILL_RATING_CHANGES={optimal:10,good:5,risky:-5,poor:-5};
