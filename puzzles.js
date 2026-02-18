// ============================================================
//  MARKETIQ — Puzzle Data
//  Edit this file to add your own puzzles
// ============================================================

// ===== DAILY PUZZLES =====
// Add as many as you want. The system serves 3 per day (indices 0-2).
// Rotate puzzles weekly by reordering or adding new entries.

const DAILY_PUZZLES = [
    {
        id: 1,
        title: "Breakout at Resistance",
        chartImage: "", // Paste image URL here e.g. "https://i.imgur.com/abc.png"
        context: "Stock XYZ has been consolidating in a tight range of $50–$52.50 for 3 weeks. Volume has been declining (avg 500k/day → 180k/day). Today, price tests the upper resistance at $52.50 for the third time. Market sentiment is neutral. 50-day MA is trending slightly upward at $49.80.",
        timeframe: "Daily Chart · 3-Month View",
        question: "What would you do?",
        options: [
            { id: "A", text: "Enter long immediately at current price $52.40", quality: "risky"   },
            { id: "B", text: "Wait for confirmed breakout with volume spike above $53", quality: "optimal" },
            { id: "C", text: "Short at resistance expecting third rejection",  quality: "poor"    },
            { id: "D", text: "Set buy limit at $51 — wait for pullback entry", quality: "good"    }
        ],
        explanation: {
            optimal: "Waiting for a confirmed breakout with elevated volume is the optimal play. A volume spike above $53 validates the move and significantly reduces false breakout risk. Patience here is discipline, not hesitation.",
            good:    "Pullback entry shows excellent risk management — lower cost basis, tighter stop. The tradeoff is missing the move if breakout runs hard without retracing.",
            risky:   "Entering before confirmation means you're anticipating, not reacting. Two rejections at $52.50 are notable; a third is possible. Risk/reward is unfavorable without confirmation.",
            poor:    "Each test at resistance weakens it — this is a pattern principle. Shorting into a triple-tested level in an uptrending market is high-risk. Probability doesn't favor this."
        }
    },
    {
        id: 2,
        title: "Earnings Gap Analysis",
        chartImage: "",
        context: "Stock ABC reported earnings that beat estimates by 12%. Pre-market volume was 3x average. Stock gapped up 8% at open ($72 → $78). 30 minutes after open, price has pulled back to $76.50 on declining volume. Overall market is flat. Sector peers are up 1–2% on average.",
        timeframe: "15-Minute Chart · Intraday",
        question: "What's your move?",
        options: [
            { id: "A", text: "Buy at $76.50 — earnings strength justifies price", quality: "poor"    },
            { id: "B", text: "Watch and do nothing — too volatile right now",     quality: "good"    },
            { id: "C", text: "Short — gap will fully fill to pre-gap $72",        quality: "risky"   },
            { id: "D", text: "Identify $75 support, buy only if it holds there",  quality: "optimal" }
        ],
        explanation: {
            optimal: "Identifying the 50% gap fill level at $75 as key support, then waiting for a confirmation hold, gives the best risk/reward. You're buying structure, not chasing.",
            good:    "Patience to let the dust settle is a professional trait. Many intraday gaps oscillate significantly. Not trading is a valid trade.",
            poor:    "Buying into early post-open pullback without defined support risks catching a full gap fill. 'Earnings beat' doesn't prevent a −8% gap fill.",
            risky:   "Shorting a stock on a fundamental earnings beat is typically fighting the tape. Gap fills happen, but timing them on strong fundamental days is low-probability."
        }
    },
    {
        id: 3,
        title: "Downtrend Reversal Signal",
        chartImage: "",
        context: "Stock DEF has been in a strong downtrend for 2 months, declining 35% from its highs. Today it formed a hammer candlestick with a long lower wick on 1.8x average volume at a prior support zone ($28). RSI reading is 32. No company news released.",
        timeframe: "Daily Chart · 6-Month View",
        question: "What's your strategy?",
        options: [
            { id: "A", text: "Enter full position now — hammer + RSI oversold = clear buy", quality: "risky"   },
            { id: "B", text: "Wait for higher high / higher low pattern to confirm reversal",  quality: "optimal" },
            { id: "C", text: "Ignore completely — one candle never reverses a trend",          quality: "poor"    },
            { id: "D", text: "Enter small starter position, add more if strength continues",   quality: "good"    }
        ],
        explanation: {
            optimal: "Waiting for structural confirmation (first higher high after a series of lower highs) is the textbook approach to trend reversal. A single hammer is a hypothesis — confirmation is proof.",
            good:    "Scaling in with a starter position and defined rules for adding is excellent risk management. You participate if right, limit damage if wrong.",
            risky:   "Committing full size to a single candle signal in a strong downtrend is premature. Downtrends produce strong bounces regularly before continuing lower.",
            poor:    "Dismissing a technically meaningful signal at key support with volume confirmation is overly rigid. Reversals start somewhere — being open to the signal while requiring confirmation is the balanced view."
        }
    }
];

// ===== THRILL ROUND PUZZLES =====
// These are randomly selected for each thrill round.
// Make them harder and more ambiguous than daily puzzles.

const THRILL_PUZZLES = [
    {
        id: "t1",
        title: "Flash Crash — No News",
        chartImage: "",
        context: "A large-cap stock drops 18% in 90 seconds on 15x normal volume. No news, no earnings, no filings. Circuit breaker triggered. Stock halted for 5 minutes. You must decide your position for when trading resumes.",
        timeframe: "1-Minute Chart · Real-Time",
        question: "When trading resumes, you will:",
        options: [
            { id: "A", text: "Buy aggressively — likely algorithmic glitch or fat-finger error", quality: "optimal" },
            { id: "B", text: "Wait 5 minutes after resumption to observe price action",          quality: "good"    },
            { id: "C", text: "Short — momentum is clearly negative, ride the tape down",          quality: "poor"    },
            { id: "D", text: "Do nothing — uncertainty is too high to act",                       quality: "risky"   }
        ],
        explanation: {
            optimal: "Flash crashes on no news are historically high-probability snap-back events — often algorithmic errors or thin liquidity. Buying panic with no fundamental catalyst is the contrarian optimal play.",
            good:    "Waiting to observe the first 5 minutes of resumed trading is prudent. You miss the immediate bounce but reduce risk of a 'real' event you haven't identified.",
            poor:    "Chasing momentum down on a no-news crash is exactly when retail gets trapped by institutional snap-back buying. These moves typically reverse violently.",
            risky:   "Inaction wastes a high-probability opportunity. Analysis paralysis in time-sensitive events is a common and costly mistake."
        }
    },
    {
        id: "t2",
        title: "VIX Spike — Volatility Surge",
        chartImage: "",
        context: "VIX has spiked from 14 to 31 in under 15 minutes. S&P 500 is down 2.8%. Your profitable tech position (entered at $100, now at $108) is down 9% today to $98. Options market is showing extreme put buying. No single catalyst has been identified yet.",
        timeframe: "Real-Time Market",
        question: "Your immediate action:",
        options: [
            { id: "A", text: "Hold — market is overreacting, position still in long-term profit",  quality: "risky"   },
            { id: "B", text: "Sell 50% here to manage risk, reassess with remaining position",     quality: "optimal" },
            { id: "C", text: "Add to position — this is a buying opportunity at lower price",      quality: "poor"    },
            { id: "D", text: "Exit full position immediately to protect capital",                    quality: "good"    }
        ],
        explanation: {
            optimal: "Selling half preserves gains on that portion, retains upside if market recovers, and reduces overall risk exposure during genuine uncertainty. The balanced professional response.",
            good:    "Full exit protects capital entirely. Overly conservative but defensible — it eliminates risk when you don't understand the catalyst.",
            risky:   "Holding through an unidentified VIX spike with options showing extreme put demand assumes you know more than the market. 'Still profitable long-term' is an ego-driven rationalization.",
            poor:    "Adding to a losing position in an extreme volatility event without understanding the catalyst is one of the most common portfolio-destroying mistakes."
        }
    },
    {
        id: "t3",
        title: "Fed Emergency Announcement",
        chartImage: "",
        context: "Federal Reserve issues unscheduled press release: emergency rate cut of 50bps effective immediately. Futures surge 3.2% in 4 minutes. You are sitting 70% cash in your portfolio. The move has already priced in significantly.",
        timeframe: "Live Market",
        question: "You immediately:",
        options: [
            { id: "A", text: "Deploy 40–50% of cash into broad market ETFs now",      quality: "optimal" },
            { id: "B", text: "Wait for the initial spike to fade, buy the pullback",   quality: "good"    },
            { id: "C", text: "Go all-in — Fed support means only one direction",       quality: "poor"    },
            { id: "D", text: "Stay in cash — news is already priced in",              quality: "risky"   }
        ],
        explanation: {
            optimal: "Deploying 40–50% of cash is measured and decisive. Fed emergency cuts historically drive sustained rallies. You act with conviction but keep dry powder for confirmation or pullback.",
            good:    "Waiting for the spike to fade and buying the pullback is technically sound. The risk is missing a sustained leg if the market doesn't retrace.",
            poor:    "Going all-in on news spikes, regardless of how bullish, ignores the possibility of the 'sell the news' reversal and removes all margin for error.",
            risky:   "Emergency Fed cuts are not routine — they signal a policy shift. Complete inaction with 70% cash on a major bullish catalyst represents excessive caution that is difficult to defend."
        }
    }
];

// ===== RATING CONSTANTS =====
const RATING_CHANGES = {
    optimal: 15,
    good:     8,
    risky:    3,
    poor:   -10
};

const THRILL_RATING_CHANGES = {
    optimal: 10,
    good:     5,
    risky:   -5,
    poor:    -5
};
