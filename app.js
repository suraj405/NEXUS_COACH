// app.js - AUTO VOICE + GEMINI REAL-TIME COACHING
class GymTrainer {
    constructor() {
        this.pose = null;
        this.video = null;
        this.canvas = null;
        this.ctx = null;
        this.isActive = false;
        this.repCount = 0;
        this.currentExercise = 'squat';
        this.exerciseState = 'resting';
        this.lastLandmarks = null;
        this.isAnalyzing = false;
        this.analysisInterval = null;
        this.voiceEnabled = true; // Auto-enabled
        this.synth = window.speechSynthesis;
        
        // Exercise configurations
        this.exerciseConfig = {
            squat: { 
                minAngle: 80, 
                maxAngle: 170, 
                repThreshold: 100
            },
            pushup: { 
                minAngle: 80, 
                maxAngle: 160, 
                repThreshold: 100
            },
            bicep: { 
                minAngle: 30, 
                maxAngle: 160, 
                repThreshold: 90
            },
            shoulder: { 
                minHeight: 30, 
                maxHeight: 70
            }
        };

        // Coaching state
        this.currentRepState = 'top';
        this.lastAngle = 0;
        this.lastRepTime = 0;
        this.lastInstructionTime = 0;
        this.consecutiveReps = 0;
        this.workoutStartTime = 0;
        this.geminiCooldown = 0;
        
        // API Key - REPLACE WITH YOUR KEY
        this.geminiApiKey = "AIzaSyCp74EmZxtfvdgiOpFhGJlZjPwp2D6upzk";
        
        this.initializeElements();
        this.setupEventListeners();
    }

    initializeElements() {
        this.video = document.getElementById('inputVideo');
        this.canvas = document.getElementById('outputCanvas');
        this.ctx = this.canvas.getContext('2d');
        
        this.canvas.width = 640;
        this.canvas.height = 480;
    }

    setupEventListeners() {
        document.getElementById('startBtn').addEventListener('click', () => this.startCamera());
        document.getElementById('stopBtn').addEventListener('click', () => this.stopCamera());
        document.getElementById('resetBtn').addEventListener('click', () => this.resetExercise());
        document.getElementById('exerciseSelect').addEventListener('change', (e) => {
            this.currentExercise = e.target.value;
            this.resetExercise();
            this.updateWorkoutButtons();
        });
        
        document.getElementById('analyzeBtn').addEventListener('click', () => this.toggleAIAnalysis());
        document.getElementById('voiceBtn').addEventListener('click', () => this.toggleVoice());
        document.getElementById('testVoiceBtn').addEventListener('click', () => this.testVoice());
        
        // Quick workout buttons
        document.querySelectorAll('.workout-option').forEach(button => {
            button.addEventListener('click', (e) => {
                const exercise = e.currentTarget.dataset.exercise;
                document.getElementById('exerciseSelect').value = exercise;
                this.currentExercise = exercise;
                this.resetExercise();
                this.updateWorkoutButtons();
                if (this.voiceEnabled) {
                    this.speak(`Switched to ${exercise}. Let's do this!`);
                }
            });
        });
    }

    updateWorkoutButtons() {
        document.querySelectorAll('.workout-option').forEach(button => {
            if (button.dataset.exercise === this.currentExercise) {
                button.classList.add('active');
            } else {
                button.classList.remove('active');
            }
        });
    }

    async startCamera() {
        try {
            this.updateCameraStatus('🔄 STARTING AI COACHING...', 'warning');
            
            // Auto-enable voice and AI
            this.voiceEnabled = true;
            document.getElementById('voiceBtn').innerHTML = '🔊 AUTO VOICE ON';
            document.getElementById('voiceBtn').style.background = 'rgba(0, 255, 136, 0.3)';
            
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: {
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    facingMode: 'user'
                } 
            });
            
            this.video.srcObject = stream;
            this.isActive = true;
            this.workoutStartTime = Date.now();
            
            document.getElementById('startBtn').disabled = true;
            document.getElementById('stopBtn').disabled = false;
            document.getElementById('resetBtn').disabled = false;
            document.getElementById('analyzeBtn').disabled = false;
            
            this.video.onloadedmetadata = () => {
                this.video.play().then(() => {
                    this.updateCameraStatus('✅ CAMERA ACTIVE - INITIALIZING AI...', 'good');
                    
                    // Welcome message with exercise instructions
                    const welcomeMessages = {
                        squat: "Welcome! I'll coach you through squats. Remember to keep your back straight and go deep!",
                        pushup: "Welcome! Let's do push-ups. Keep your body straight and lower with control!",
                        bicep: "Welcome! Time for bicep curls. Keep elbows locked and squeeze at the top!",
                        shoulder: "Welcome! Shoulder press time. Press overhead and keep core tight!"
                    };
                    
                    if (this.voiceEnabled) {
                        this.speak(welcomeMessages[this.currentExercise] || "Welcome to AI Gym Coach! Let's get strong together!");
                    }
                    
                    this.initializePose();
                }).catch(error => {
                    console.error('Video play error:', error);
                    this.updateCameraStatus('❌ VIDEO ERROR', 'bad');
                });
            };
            
        } catch (error) {
            console.error('Camera access error:', error);
            this.handleCameraError(error);
        }
    }

    async initializePose() {
        try {
            this.pose = new Pose({
                locateFile: (file) => {
                    return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
                }
            });

            this.pose.setOptions({
                modelComplexity: 1,
                smoothLandmarks: true,
                minDetectionConfidence: 0.5,
                minTrackingConfidence: 0.5
            });

            this.pose.onResults((results) => this.onPoseResults(results));
            
            this.updateCameraStatus('✅ AI COACH READY - BEGIN WORKOUT!', 'good');
            this.startPoseDetection();
            
            // Auto-enable AI analysis
            this.toggleAIAnalysis();
            
        } catch (error) {
            console.error('Pose initialization error:', error);
            this.updateCameraStatus('❌ AI INIT FAILED', 'bad');
        }
    }

    async startPoseDetection() {
        if (!this.isActive) return;

        try {
            await this.pose.send({image: this.video});
            
            if (this.isActive) {
                requestAnimationFrame(() => this.startPoseDetection());
            }
        } catch (error) {
            console.error('Pose detection error:', error);
            if (this.isActive) {
                setTimeout(() => this.startPoseDetection(), 100);
            }
        }
    }

    onPoseResults(results) {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Draw video frame (mirrored)
        this.ctx.save();
        this.ctx.scale(-1, 1);
        this.ctx.translate(-this.canvas.width, 0);
        this.ctx.drawImage(results.image, 0, 0, this.canvas.width, this.canvas.height);
        this.ctx.restore();

        if (results.poseLandmarks) {
            this.lastLandmarks = results.poseLandmarks;
            this.drawPoseLandmarks(results.poseLandmarks);
            this.analyzeForm(results.poseLandmarks);
            this.updateTrackingStatus('✅ BODY TRACKING ACTIVE - AI COACHING', 'good');
        } else {
            this.updateTrackingStatus('👤 MOVE INTO FRAME FOR AI COACHING', 'warning');
            this.updateFeedback('Step into camera view to begin workout', 'warning');
        }
    }

    drawPoseLandmarks(landmarks) {
        // Draw connections
        const connections = [
            [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
            [11, 23], [12, 24], [23, 24], [23, 25], [24, 26],
            [25, 27], [26, 28]
        ];

        this.ctx.strokeStyle = '#00FF88';
        this.ctx.lineWidth = 3;
        this.ctx.lineCap = 'round';

        connections.forEach(([start, end]) => {
            const startPoint = landmarks[start];
            const endPoint = landmarks[end];
            
            if (startPoint.visibility > 0.5 && endPoint.visibility > 0.5) {
                this.ctx.beginPath();
                this.ctx.moveTo(
                    (1 - startPoint.x) * this.canvas.width,
                    startPoint.y * this.canvas.height
                );
                this.ctx.lineTo(
                    (1 - endPoint.x) * this.canvas.width,
                    endPoint.y * this.canvas.height
                );
                this.ctx.stroke();
            }
        });

        // Draw key points
        this.ctx.fillStyle = '#FF0000';
        [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28].forEach(index => {
            const landmark = landmarks[index];
            if (landmark.visibility > 0.5) {
                this.ctx.beginPath();
                this.ctx.arc(
                    (1 - landmark.x) * this.canvas.width,
                    landmark.y * this.canvas.height,
                    4, 0, 2 * Math.PI
                );
                this.ctx.fill();
            }
        });
    }

    analyzeForm(landmarks) {
        const currentAngle = this.calculateExerciseAngle(landmarks);
        this.updateAngleDisplay(currentAngle);
        
        if (currentAngle > 0) {
            this.detectRepetition(currentAngle, landmarks);
            this.provideRealTimeCoaching(currentAngle, landmarks);
        }
    }

    calculateExerciseAngle(landmarks) {
        try {
            switch(this.currentExercise) {
                case 'squat':
                    return this.calculateKneeAngle(landmarks);
                case 'pushup':
                case 'bicep':
                    return this.calculateElbowAngle(landmarks);
                case 'shoulder':
                    return this.calculateShoulderHeight(landmarks);
                default:
                    return this.calculateElbowAngle(landmarks);
            }
        } catch (error) {
            return 0;
        }
    }

    calculateKneeAngle(landmarks) {
        const hip = landmarks[24];
        const knee = landmarks[26];
        const ankle = landmarks[28];
        
        if (hip && knee && ankle) {
            return this.calculateAngle(hip, knee, ankle);
        }
        return 0;
    }

    calculateElbowAngle(landmarks) {
        const shoulder = landmarks[12];
        const elbow = landmarks[14];
        const wrist = landmarks[16];
        
        if (shoulder && elbow && wrist) {
            return this.calculateAngle(shoulder, elbow, wrist);
        }
        return 0;
    }

    calculateShoulderHeight(landmarks) {
        const shoulder = landmarks[12];
        const wrist = landmarks[16];
        
        if (shoulder && wrist) {
            const height = (shoulder.y - wrist.y) * 100;
            return Math.max(0, Math.min(100, Math.round(height)));
        }
        return 0;
    }

    calculateAngle(a, b, c) {
        const ab = [b.x - a.x, b.y - a.y];
        const cb = [b.x - c.x, b.y - c.y];
        
        const dot = ab[0] * cb[0] + ab[1] * cb[1];
        const magAB = Math.sqrt(ab[0] * ab[0] + ab[1] * ab[1]);
        const magCB = Math.sqrt(cb[0] * cb[0] + cb[1] * cb[1]);
        
        if (magAB === 0 || magCB === 0) return 0;
        
        const angle = Math.acos(dot / (magAB * magCB)) * (180 / Math.PI);
        return Math.round(angle);
    }

    detectRepetition(currentAngle, landmarks) {
        const config = this.exerciseConfig[this.currentExercise];
        if (!config) return;

        const now = Date.now();
        const timeSinceLastRep = now - this.lastRepTime;
        
        if (timeSinceLastRep < 1000) return;

        if (this.currentExercise === 'squat' || this.currentExercise === 'pushup') {
            if (currentAngle < config.minAngle && this.currentRepState === 'top') {
                this.currentRepState = 'bottom';
                this.updateFeedback('Perfect! Push back up powerfully', 'good');
                if (this.voiceEnabled) {
                    this.speak(this.getFormFeedback('bottom', currentAngle));
                }
            }
            else if (currentAngle > config.maxAngle && this.currentRepState === 'bottom') {
                this.completeRepetition(now);
            }
        }
        else if (this.currentExercise === 'bicep') {
            if (currentAngle < config.minAngle && this.currentRepState === 'top') {
                this.currentRepState = 'contracted';
                this.updateFeedback('Strong squeeze! Lower slowly', 'good');
                if (this.voiceEnabled) {
                    this.speak("Great contraction! Now lower with control!");
                }
            }
            else if (currentAngle > config.maxAngle && this.currentRepState === 'contracted') {
                this.completeRepetition(now);
            }
        }
    }

    completeRepetition(now) {
        this.repCount++;
        this.currentRepState = 'top';
        this.lastRepTime = now;
        this.consecutiveReps++;
        this.updateRepCounter();
        this.updateFeedback(`Perfect rep #${this.repCount}!`, 'good');
        
        // Voice feedback for completed rep
        if (this.voiceEnabled) {
            const messages = [
                `Excellent! ${this.repCount} reps complete!`,
                `Great work! That's ${this.repCount}!`,
                `Perfect form! ${this.repCount} done!`,
                `You're crushing it! ${this.repCount} reps!`,
                `Strong! ${this.repCount} completed with great form!`
            ];
            this.speak(messages[Math.floor(Math.random() * messages.length)]);
        }
        
        // Use Gemini AI for form analysis every 3 reps
        if (this.repCount % 3 === 0 && this.isAnalyzing && this.geminiApiKey) {
            this.analyzeWithGemini();
        }
    }

    provideRealTimeCoaching(currentAngle, landmarks) {
        if (!this.voiceEnabled) return;

        const now = Date.now();
        const timeSinceLastInstruction = now - this.lastInstructionTime;
        
        // Provide coaching every 15-20 seconds
        if (timeSinceLastInstruction > 15000 + Math.random() * 5000) {
            const coachingTips = {
                squat: [
                    "Remember to keep your chest up and back straight!",
                    "Push through your heels, not your toes!",
                    "Go deep for maximum muscle engagement!",
                    "Keep your core tight throughout the movement!",
                    "You're building strong legs and glutes!"
                ],
                pushup: [
                    "Maintain a straight line from head to heels!",
                    "Lower yourself with control for better results!",
                    "Engage your core and glutes!",
                    "Full range of motion builds more strength!",
                    "You're building amazing upper body strength!"
                ],
                bicep: [
                    "Keep those elbows locked at your sides!",
                    "Squeeze hard at the top of each rep!",
                    "Control the weight on the way down!",
                    "Focus on the muscle-mind connection!",
                    "You're building impressive arm strength!"
                ],
                shoulder: [
                    "Press directly overhead, keep core tight!",
                    "Control the descent for better muscle growth!",
                    "Don't arch your back during the press!",
                    "Full extension builds shoulder definition!",
                    "You're building strong, capped shoulders!"
                ]
            };
            
            const tips = coachingTips[this.currentExercise];
            if (tips && tips.length > 0) {
                const tip = tips[Math.floor(Math.random() * tips.length)];
                this.speak(tip);
                this.lastInstructionTime = now;
            }
        }
    }

    getFormFeedback(position, angle) {
        const feedback = {
            squat: {
                bottom: angle < 70 ? "Too deep! Aim for 90 degrees" : "Perfect depth! Now drive up!",
                top: "Great! Ready for next rep!"
            },
            pushup: {
                bottom: "Perfect! Chest almost touching, now push up!",
                top: "Excellent! Full extension achieved!"
            },
            bicep: {
                contracted: "Strong squeeze! Lower with control!",
                top: "Perfect! Full range of motion!"
            }
        };
        
        return feedback[this.currentExercise]?.[position] || "Good form! Keep going!";
    }

    async analyzeWithGemini() {
        if (!this.lastLandmarks || !this.geminiApiKey || !this.isAnalyzing) return;
        
        // Cooldown to prevent too many API calls
        const now = Date.now();
        if (now - this.geminiCooldown < 10000) return;
        this.geminiCooldown = now;

        try {
            this.updateAIAnalysisStatus('<span class="loading"></span> Analyzing form with AI...', 'warning');
            
            const poseData = this.getPoseDataSummary();
            const response = await this.callGeminiAPI(this.currentExercise, poseData);
            this.displayGeminiFeedback(response);
            
            // Speak the AI analysis
            if (this.voiceEnabled) {
                const spokenFeedback = this.extractSpokenFeedback(response);
                this.speak(spokenFeedback);
            }
            
        } catch (error) {
            console.error('Gemini API error:', error);
            this.updateAIAnalysisStatus('AI analysis failed', 'bad');
        }
    }

    extractSpokenFeedback(analysisText) {
        // Extract the most important feedback for voice
        if (analysisText.includes('Excellent') || analysisText.includes('Perfect')) {
            return "AI Analysis: Your form is excellent! Keep up the great work!";
        } else if (analysisText.includes('Good') || analysisText.includes('Well')) {
            return "AI Analysis: Good form! Minor adjustments needed for perfection.";
        } else if (analysisText.includes('Improve') || analysisText.includes('Adjust')) {
            return "AI Analysis: Some adjustments needed. Focus on proper form.";
        } else {
            return "AI Analysis: Keep working on your form for better results!";
        }
    }

    getPoseDataSummary() {
        if (!this.lastLandmarks) return {};
        
        return {
            exercise: this.currentExercise,
            reps: this.repCount,
            state: this.currentRepState,
            consecutive_reps: this.consecutiveReps,
            workout_duration: Date.now() - this.workoutStartTime
        };
    }

    async callGeminiAPI(exercise, poseData) {
        const prompt = `As a professional fitness coach, analyze this workout session and provide brief, actionable feedback:

Exercise: ${exercise}
Total Reps: ${poseData.reps}
Current State: ${poseData.state}
Consecutive Reps: ${poseData.consecutive_reps}
Workout Duration: ${Math.round(poseData.workout_duration / 1000)} seconds

Provide 2-3 sentences of encouraging, professional feedback focusing on form and motivation.`;

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${this.geminiApiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: prompt
                    }]
                }],
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 150,
                }
            })
        });

        if (!response.ok) {
            throw new Error(`API request failed: ${response.status}`);
        }

        const data = await response.json();
        return data.candidates[0].content.parts[0].text;
    }

    displayGeminiFeedback(analysisText) {
        const feedbackElement = document.getElementById('aiFeedback');
        feedbackElement.innerHTML = `<div class="ai-instruction"><strong>🤖 Gemini AI:</strong> ${analysisText}</div>`;
        this.updateAIAnalysisStatus('AI Analysis Complete', 'good');
    }

    toggleVoice() {
        this.voiceEnabled = !this.voiceEnabled;
        const voiceBtn = document.getElementById('voiceBtn');
        
        if (this.voiceEnabled) {
            voiceBtn.innerHTML = '🔊 AUTO VOICE ON';
            voiceBtn.style.background = 'rgba(0, 255, 136, 0.3)';
            this.speak("Voice coach activated! I'll guide you through every movement.");
        } else {
            voiceBtn.innerHTML = '🔇 VOICE OFF';
            voiceBtn.style.background = 'rgba(255, 45, 117, 0.2)';
            this.synth.cancel();
        }
    }

    testVoice() {
        this.speak("This is your AI personal trainer! I provide real-time feedback using Gemini AI. Let's make this an amazing workout!");
    }

    speak(text) {
        if (!this.voiceEnabled || this.synth.speaking) return;
        
        this.synth.cancel();
        
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.volume = 0.8;
        
        document.getElementById('voiceFeedback').innerHTML = 
            `<div class="ai-instruction"><strong>🎤 AI Coach:</strong> ${text}</div>`;
        
        this.synth.speak(utterance);
    }

    toggleAIAnalysis() {
        if (!this.geminiApiKey || this.geminiApiKey === "YOUR_GEMINI_API_KEY_HERE") {
            alert('Please set your Gemini API key in the app.js file first!');
            return;
        }

        this.isAnalyzing = !this.isAnalyzing;
        const analyzeBtn = document.getElementById('analyzeBtn');
        
        if (this.isAnalyzing) {
            analyzeBtn.innerHTML = '🤖 GEMINI AI ACTIVE';
            analyzeBtn.style.background = 'linear-gradient(135deg, #00ccff, #0099cc)';
            this.updateAIAnalysisStatus('Gemini AI Active - Analyzing Form', 'good');
            if (this.voiceEnabled) {
                this.speak("Gemini AI activated! I'll analyze your form and provide expert feedback.");
            }
        } else {
            analyzeBtn.innerHTML = '🤖 ENABLE GEMINI AI';
            analyzeBtn.style.background = 'linear-gradient(135deg, var(--primary), var(--secondary))';
            this.updateAIAnalysisStatus('Gemini AI Paused', '');
        }
    }

    resetExercise() {
        this.repCount = 0;
        this.currentRepState = 'top';
        this.lastRepTime = 0;
        this.consecutiveReps = 0;
        this.updateRepCounter();
        this.updateAngleDisplay('--');
        this.updateFeedback('Reps reset! Ready for new set!', 'good');
        
        if (this.voiceEnabled && this.isActive) {
            this.speak("Reps reset! Let's start a new set with fresh energy!");
        }
    }

    stopCamera() {
        this.isActive = false;
        this.isAnalyzing = false;
        
        if (this.video.srcObject) {
            const tracks = this.video.srcObject.getTracks();
            tracks.forEach(track => track.stop());
            this.video.srcObject = null;
        }
        
        document.getElementById('startBtn').disabled = false;
        document.getElementById('stopBtn').disabled = true;
        document.getElementById('resetBtn').disabled = true;
        document.getElementById('analyzeBtn').innerHTML = '🤖 ENABLE GEMINI AI';
        
        // Final voice message
        if (this.voiceEnabled && this.repCount > 0) {
            this.speak(`Amazing workout! You completed ${this.repCount} reps with great form. You're getting stronger every day!`);
        }
        
        this.updateCameraStatus('⏹️ WORKOUT COMPLETE', '');
        this.updateTrackingStatus('Great session! Ready for next workout', 'good');
        this.updateFeedback(`Completed ${this.repCount} reps! Excellent work!`, 'good');
        
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    updateRepCounter() {
        document.getElementById('repCounter').textContent = this.repCount;
    }

    updateAngleDisplay(angle) {
        document.getElementById('angleDisplay').textContent = 
            typeof angle === 'number' ? angle + '°' : angle;
    }

    updateFeedback(message, type) {
        const element = document.getElementById('feedbackText');
        element.textContent = message;
        element.className = type || '';
    }

    updateCameraStatus(message, type) {
        const element = document.getElementById('cameraStatus');
        element.textContent = message;
        element.style.background = type === 'good' ? 'rgba(0, 255, 136, 0.1)' : 
                                type === 'warning' ? 'rgba(255, 204, 0, 0.1)' : 'rgba(255, 45, 117, 0.1)';
        element.style.borderLeftColor = type === 'good' ? '#00ff88' : 
                                      type === 'warning' ? '#ffcc00' : '#ff2d75';
    }

    updateTrackingStatus(message, type) {
        const element = document.getElementById('trackingStatus');
        if (element) {
            element.textContent = message;
            element.style.color = type === 'good' ? '#00ff88' : '#ffcc00';
        }
    }

    updateAIAnalysisStatus(message, type) {
        const element = document.getElementById('aiFeedback');
        if (!message.includes('loading')) {
            element.innerHTML = `<p style="color: ${type === 'good' ? '#00ff88' : '#ffcc00'}">${message}</p>`;
        }
    }

    handleCameraError(error) {
        let message = 'Camera access denied. ';
        
        if (error.name === 'NotAllowedError') {
            message += 'Please allow camera permissions in your browser.';
        } else if (error.name === 'NotFoundError') {
            message += 'No camera found on your device.';
        } else {
            message += `Error: ${error.message}`;
        }
        
        this.updateCameraStatus('❌ ' + message, 'bad');
        alert(message);
    }
}

// Initialize when page loads
window.addEventListener('DOMContentLoaded', () => {
    new GymTrainer();
    console.log('Nexus Gym AI with Auto Voice initialized');
});