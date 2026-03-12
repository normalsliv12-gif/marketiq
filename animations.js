// ============================================================
//  MARKETIQ — Professional Animation Engine
//  Production-grade animations, micro-interactions, particle systems
// ============================================================

class AnimationEngine {
    constructor() {
        this.particles = [];
        this.observers = new Map();
        this.initialized = false;
    }

    init() {
        if (this.initialized) return;
        this.setupIntersectionObservers();
        this.setupScrollAnimations();
        this.initialized = true;
    }

    // ============================================================
    //  CONFETTI SYSTEM — Celebration particles
    // ============================================================
    confetti(target, options = {}) {
        const {
            count = 50,
            colors = ['#00e5ff', '#00e676', '#ffb800', '#ff6e42'],
            velocity = 8,
            spread = 120,
            gravity = 0.4
        } = options;

        const rect = target.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        for (let i = 0; i < count; i++) {
            const particle = document.createElement('div');
            particle.className = 'confetti-particle';
            
            const angle = (Math.random() * spread - spread / 2) * (Math.PI / 180);
            const speed = velocity * (0.5 + Math.random() * 0.5);
            const vx = Math.cos(angle) * speed;
            const vy = Math.sin(angle) * speed - (velocity * 0.5);
            
            const color = colors[Math.floor(Math.random() * colors.length)];
            const size = 6 + Math.random() * 4;
            const rotation = Math.random() * 360;
            const rotationSpeed = (Math.random() - 0.5) * 20;

            particle.style.cssText = `
                position: fixed;
                left: ${centerX}px;
                top: ${centerY}px;
                width: ${size}px;
                height: ${size}px;
                background: ${color};
                border-radius: ${Math.random() > 0.5 ? '50%' : '2px'};
                transform: rotate(${rotation}deg);
                pointer-events: none;
                z-index: 10000;
            `;

            document.body.appendChild(particle);

            this.animateParticle(particle, { vx, vy, rotationSpeed, gravity });
        }
    }

    animateParticle(particle, { vx, vy, rotationSpeed, gravity }) {
        let x = 0, y = 0, velocityY = vy, rotation = 0;
        let opacity = 1;
        const startTime = Date.now();
        const duration = 1500;

        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = elapsed / duration;

            if (progress >= 1) {
                particle.remove();
                return;
            }

            x += vx;
            y += velocityY;
            velocityY += gravity;
            rotation += rotationSpeed;
            opacity = 1 - progress;

            particle.style.transform = `translate(${x}px, ${y}px) rotate(${rotation}deg)`;
            particle.style.opacity = opacity;

            requestAnimationFrame(animate);
        };

        requestAnimationFrame(animate);
    }

    // ============================================================
    //  NUMBER COUNT-UP ANIMATION
    // ============================================================
    countUp(element, start, end, duration = 1000, formatter = null) {
        const startTime = Date.now();
        const range = end - start;

        const easeOutQuart = t => 1 - Math.pow(1 - t, 4);

        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const easedProgress = easeOutQuart(progress);
            const current = start + (range * easedProgress);

            const value = progress === 1 ? end : current;
            element.textContent = formatter ? formatter(value) : Math.round(value);

            if (progress < 1) {
                requestAnimationFrame(animate);
            }
        };

        requestAnimationFrame(animate);
    }

    // ============================================================
    //  SKELETON LOADER
    // ============================================================
    showSkeleton(container, type = 'leaderboard', count = 10) {
        const templates = {
            leaderboard: () => `
                <div class="skeleton-row" style="animation-delay: ${Math.random() * 0.2}s">
                    <div class="skeleton-item shimmer" style="width:60px; height:20px; border-radius:4px;"></div>
                    <div class="skeleton-item shimmer" style="width:140px; height:20px; border-radius:4px;"></div>
                    <div class="skeleton-item shimmer" style="width:80px; height:20px; border-radius:4px;"></div>
                    <div class="skeleton-item shimmer" style="width:70px; height:20px; border-radius:4px;"></div>
                </div>
            `,
            card: () => `
                <div class="skeleton-card">
                    <div class="skeleton-item shimmer" style="width:100%; height:180px; border-radius:12px; margin-bottom:16px;"></div>
                    <div class="skeleton-item shimmer" style="width:80%; height:24px; border-radius:4px; margin-bottom:12px;"></div>
                    <div class="skeleton-item shimmer" style="width:60%; height:16px; border-radius:4px;"></div>
                </div>
            `,
            stats: () => `
                <div class="skeleton-stat">
                    <div class="skeleton-item shimmer" style="width:100px; height:36px; border-radius:8px; margin-bottom:8px;"></div>
                    <div class="skeleton-item shimmer" style="width:60px; height:14px; border-radius:4px;"></div>
                </div>
            `
        };

        const template = templates[type] || templates.leaderboard;
        container.innerHTML = Array(count).fill().map(() => template()).join('');
        container.classList.add('skeleton-loading');
    }

    // ============================================================
    //  STAGGER ANIMATION — Reveal items sequentially
    // ============================================================
    stagger(elements, options = {}) {
        const {
            delay = 80,
            animation = 'fadeInUp',
            distance = 20
        } = options;

        elements.forEach((el, index) => {
            el.style.opacity = '0';
            el.style.transform = `translateY(${distance}px)`;
            
            setTimeout(() => {
                el.style.transition = 'opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1), transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
                el.style.opacity = '1';
                el.style.transform = 'translateY(0)';
            }, index * delay);
        });
    }

    // ============================================================
    //  PULSE EFFECT — Attention grabber
    // ============================================================
    pulse(element, options = {}) {
        const { duration = 600, scale = 1.05, color = null } = options;
        
        const originalTransform = element.style.transform;
        const originalBg = element.style.background;

        element.style.transition = `transform ${duration}ms cubic-bezier(0.4, 0, 0.2, 1)`;
        element.style.transform = `scale(${scale})`;
        
        if (color) {
            element.style.background = color;
        }

        setTimeout(() => {
            element.style.transform = originalTransform;
            if (color) {
                setTimeout(() => {
                    element.style.background = originalBg;
                }, duration / 2);
            }
        }, duration);
    }

    // ============================================================
    //  SHAKE ANIMATION — Error feedback
    // ============================================================
    shake(element, options = {}) {
        const { intensity = 10, duration = 500 } = options;
        
        element.style.animation = 'none';
        setTimeout(() => {
            element.style.animation = `shake ${duration}ms cubic-bezier(0.36, 0.07, 0.19, 0.97)`;
        }, 10);

        setTimeout(() => {
            element.style.animation = '';
        }, duration);
    }

    // ============================================================
    //  RIPPLE EFFECT — Material-style click feedback
    // ============================================================
    ripple(element, event) {
        const ripple = document.createElement('span');
        const rect = element.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height);
        const x = event.clientX - rect.left - size / 2;
        const y = event.clientY - rect.top - size / 2;

        ripple.style.cssText = `
            position: absolute;
            width: ${size}px;
            height: ${size}px;
            border-radius: 50%;
            background: rgba(0, 229, 255, 0.3);
            transform: translate(${x}px, ${y}px) scale(0);
            animation: rippleEffect 0.6s ease-out;
            pointer-events: none;
        `;

        element.style.position = 'relative';
        element.style.overflow = 'hidden';
        element.appendChild(ripple);

        setTimeout(() => ripple.remove(), 600);
    }

    // ============================================================
    //  TYPEWRITER EFFECT
    // ============================================================
    typewriter(element, text, options = {}) {
        const { speed = 50, cursor = true, onComplete = null } = options;
        let index = 0;
        element.textContent = '';

        if (cursor) {
            element.insertAdjacentHTML('afterend', '<span class="typewriter-cursor">|</span>');
        }

        const type = () => {
            if (index < text.length) {
                element.textContent += text.charAt(index);
                index++;
                setTimeout(type, speed + Math.random() * 20);
            } else {
                if (cursor) {
                    const cursorEl = element.nextElementSibling;
                    if (cursorEl && cursorEl.classList.contains('typewriter-cursor')) {
                        setTimeout(() => cursorEl.remove(), 500);
                    }
                }
                if (onComplete) onComplete();
            }
        };

        type();
    }

    // ============================================================
    //  SCROLL-TRIGGERED ANIMATIONS
    // ============================================================
    setupIntersectionObservers() {
        const observerOptions = {
            threshold: 0.1,
            rootMargin: '0px 0px -100px 0px'
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('aos-animate');
                    observer.unobserve(entry.target);
                }
            });
        }, observerOptions);

        // Observe elements with [data-aos] attribute
        document.querySelectorAll('[data-aos]').forEach(el => {
            observer.observe(el);
        });

        this.observers.set('aos', observer);
    }

    setupScrollAnimations() {
        let ticking = false;
        let lastScrollY = 0;

        const updateParallax = () => {
            const scrollY = window.scrollY;
            const elements = document.querySelectorAll('[data-parallax]');

            elements.forEach(el => {
                const speed = parseFloat(el.dataset.parallax) || 0.5;
                const yPos = -(scrollY * speed);
                el.style.transform = `translateY(${yPos}px)`;
            });

            ticking = false;
        };

        window.addEventListener('scroll', () => {
            lastScrollY = window.scrollY;
            if (!ticking) {
                requestAnimationFrame(updateParallax);
                ticking = true;
            }
        });
    }

    // ============================================================
    //  LOADING STATE MANAGER
    // ============================================================
    showLoading(container, message = 'Loading...') {
        container.innerHTML = `
            <div class="loading-state">
                <div class="loading-spinner-pro"></div>
                <p class="loading-message">${message}</p>
            </div>
        `;
    }

    hideLoading(container) {
        const loadingState = container.querySelector('.loading-state');
        if (loadingState) {
            loadingState.style.opacity = '0';
            setTimeout(() => loadingState.remove(), 200);
        }
    }

    // ============================================================
    //  SUCCESS CHECKMARK ANIMATION
    // ============================================================
    showSuccess(container, message = 'Success!') {
        const successEl = document.createElement('div');
        successEl.className = 'success-checkmark-container';
        successEl.innerHTML = `
            <svg class="success-checkmark" viewBox="0 0 52 52">
                <circle class="success-checkmark-circle" cx="26" cy="26" r="25" fill="none"/>
                <path class="success-checkmark-check" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8"/>
            </svg>
            <p class="success-message">${message}</p>
        `;
        
        container.appendChild(successEl);

        setTimeout(() => {
            successEl.classList.add('success-show');
        }, 10);

        return successEl;
    }
}

// ============================================================
//  GLOBAL ANIMATION UTILITIES
// ============================================================

const animations = new AnimationEngine();

// Auto-initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => animations.init());
} else {
    animations.init();
}

// Export for use in app.js
window.AnimationEngine = AnimationEngine;
window.animations = animations;
