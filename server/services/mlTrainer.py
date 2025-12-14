#!/usr/bin/env python3
"""
AI Filter Model Trainer for KrakenBot
Uses RandomForest with walk-forward validation
"""

import sys
import json
import os
import pickle

MODEL_DIR = "/tmp/models"
MODEL_PATH = f"{MODEL_DIR}/ai_filter.joblib"
STATUS_PATH = f"{MODEL_DIR}/ai_status.json"

def ensure_model_dir():
    if not os.path.exists(MODEL_DIR):
        os.makedirs(MODEL_DIR, exist_ok=True)

def extract_features_from_sample(sample):
    """Extract feature vector from a sample's featuresJson"""
    features = sample.get("featuresJson", {})
    if isinstance(features, str):
        features = json.loads(features)
    
    return [
        float(features.get("rsi14", 50)),
        float(features.get("macdLine", 0)),
        float(features.get("macdSignal", 0)),
        float(features.get("macdHist", 0)),
        float(features.get("bbUpper", 0)),
        float(features.get("bbMiddle", 0)),
        float(features.get("bbLower", 0)),
        float(features.get("atr14", 0)),
        float(features.get("ema12", 0)),
        float(features.get("ema26", 0)),
        float(features.get("volume24hChange", 0)),
        float(features.get("priceChange1h", 0)),
        float(features.get("priceChange4h", 0)),
        float(features.get("priceChange24h", 0)),
        float(features.get("spreadPct", 0)),
        float(features.get("confidence", 50)),
    ]

def train(samples_path):
    """Train RandomForest model on samples"""
    try:
        from sklearn.ensemble import RandomForestClassifier
        from sklearn.model_selection import TimeSeriesSplit
        from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score
        import numpy as np
    except ImportError:
        print(json.dumps({"success": False, "error": "sklearn not installed"}))
        sys.exit(1)
    
    ensure_model_dir()
    
    with open(samples_path, 'r') as f:
        samples = json.load(f)
    
    complete_samples = [s for s in samples if s.get("isComplete") and s.get("labelWin") is not None]
    
    if len(complete_samples) < 50:
        print(json.dumps({"success": False, "error": f"Not enough samples: {len(complete_samples)}"}))
        sys.exit(1)
    
    X = []
    y = []
    
    for sample in complete_samples:
        try:
            features = extract_features_from_sample(sample)
            label = int(sample["labelWin"])
            X.append(features)
            y.append(label)
        except Exception as e:
            continue
    
    X = np.array(X)
    y = np.array(y)
    
    tscv = TimeSeriesSplit(n_splits=min(5, len(X) // 20))
    
    accuracies = []
    precisions = []
    recalls = []
    f1s = []
    
    for train_idx, test_idx in tscv.split(X):
        X_train, X_test = X[train_idx], X[test_idx]
        y_train, y_test = y[train_idx], y[test_idx]
        
        model = RandomForestClassifier(
            n_estimators=100,
            max_depth=10,
            min_samples_split=5,
            min_samples_leaf=2,
            random_state=42,
            class_weight='balanced'
        )
        
        model.fit(X_train, y_train)
        y_pred = model.predict(X_test)
        
        accuracies.append(accuracy_score(y_test, y_pred))
        precisions.append(precision_score(y_test, y_pred, zero_division=0))
        recalls.append(recall_score(y_test, y_pred, zero_division=0))
        f1s.append(f1_score(y_test, y_pred, zero_division=0))
    
    final_model = RandomForestClassifier(
        n_estimators=100,
        max_depth=10,
        min_samples_split=5,
        min_samples_leaf=2,
        random_state=42,
        class_weight='balanced'
    )
    final_model.fit(X, y)
    
    with open(MODEL_PATH, 'wb') as f:
        pickle.dump(final_model, f)
    
    metrics = {
        "accuracy": float(np.mean(accuracies)),
        "precision": float(np.mean(precisions)),
        "recall": float(np.mean(recalls)),
        "f1": float(np.mean(f1s)),
        "nSamples": len(complete_samples),
        "trainedAt": str(os.popen('date -u +"%Y-%m-%dT%H:%M:%SZ"').read().strip())
    }
    
    with open(STATUS_PATH, 'w') as f:
        json.dump(metrics, f, indent=2)
    
    print(json.dumps({"success": True, "metrics": metrics}))

def predict(features_json):
    """Predict approval probability for given features"""
    ensure_model_dir()
    
    if not os.path.exists(MODEL_PATH):
        print(json.dumps({"score": 0.5, "error": "Model not found"}))
        return
    
    try:
        with open(MODEL_PATH, 'rb') as f:
            model = pickle.load(f)
        
        features = json.loads(features_json)
        
        X = [[
            float(features.get("rsi14", 50)),
            float(features.get("macdLine", 0)),
            float(features.get("macdSignal", 0)),
            float(features.get("macdHist", 0)),
            float(features.get("bbUpper", 0)),
            float(features.get("bbMiddle", 0)),
            float(features.get("bbLower", 0)),
            float(features.get("atr14", 0)),
            float(features.get("ema12", 0)),
            float(features.get("ema26", 0)),
            float(features.get("volume24hChange", 0)),
            float(features.get("priceChange1h", 0)),
            float(features.get("priceChange4h", 0)),
            float(features.get("priceChange24h", 0)),
            float(features.get("spreadPct", 0)),
            float(features.get("confidence", 50)),
        ]]
        
        proba = model.predict_proba(X)[0]
        score = float(proba[1]) if len(proba) > 1 else 0.5
        
        print(json.dumps({"score": score}))
        
    except Exception as e:
        print(json.dumps({"score": 0.5, "error": str(e)}))

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: mlTrainer.py <train|predict> <arg>"}))
        sys.exit(1)
    
    command = sys.argv[1]
    
    if command == "train" and len(sys.argv) >= 3:
        train(sys.argv[2])
    elif command == "predict" and len(sys.argv) >= 3:
        predict(sys.argv[2])
    else:
        print(json.dumps({"error": f"Unknown command: {command}"}))
        sys.exit(1)
