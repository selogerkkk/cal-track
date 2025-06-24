/* ========================================
   CALCULADORA INTELIGENTE DE PESO - LOGIC
   ======================================== */

// ============================================================================
// CONFIGURAÇÃO E VARIÁVEIS GLOBAIS
// ============================================================================

// Variáveis globais para SQLite
let db = null;
let SQL = null;
let currentUser = 'default'; // Sistema multi-usuário básico

// Configurações da aplicação
const CONFIG = {
  CALORIES_PER_KG: 7700, // kcal por kg de gordura
  MIN_DAYS_FOR_TDEE: 7,  // Mínimo de dias para calcular TDEE real
  IDEAL_DAYS_FOR_TDEE: 21, // Dias ideais para alta confiança
  MAX_ANALYSIS_DAYS: 30,   // Máximo de dias para análise
  REASONABLE_TDEE_MIN: 1200,
  REASONABLE_TDEE_MAX: 4000
};

// ============================================================================
// INICIALIZAÇÃO E BANCO DE DADOS
// ============================================================================

class DatabaseManager {
  static async initialize() {
    try {
      const sqlPromise = initSqlJs({
        locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
      });
      SQL = await sqlPromise;
      
      // Tentar carregar banco existente do localStorage
      const savedDb = localStorage.getItem(`weightTrackerDB_${currentUser}`);
      if (savedDb) {
        const uIntArray = new Uint8Array(JSON.parse(savedDb));
        db = new SQL.Database(uIntArray);
      } else {
        db = new SQL.Database();
      }
      
      // Criar tabelas se não existirem
      this.createTables();
      
      console.log('✅ Banco de dados inicializado com sucesso');
      return true;
      
    } catch (error) {
      console.error('❌ Erro ao inicializar banco:', error);
      this.initFallbackStorage();
      return false;
    }
  }

  static createTables() {
    db.run(`
      CREATE TABLE IF NOT EXISTS weight_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT DEFAULT 'default',
        date TEXT NOT NULL,
        weight REAL NOT NULL,
        calories INTEGER,
        activity_level TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, date)
      )
    `);
    
    db.run(`
      CREATE TABLE IF NOT EXISTS user_profile (
        id INTEGER PRIMARY KEY,
        user_id TEXT UNIQUE DEFAULT 'default',
        height REAL,
        age INTEGER,
        gender TEXT,
        target_weight REAL,
        activity_level REAL,
        deficit_strategy INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  static initFallbackStorage() {
    console.log('🔄 Usando sistema de fallback (localStorage)');
    if (!localStorage.getItem(`weightEntries_${currentUser}`)) {
      localStorage.setItem(`weightEntries_${currentUser}`, JSON.stringify([]));
    }
  }

  static save() {
    if (db) {
      const data = db.export();
      localStorage.setItem(`weightTrackerDB_${currentUser}`, JSON.stringify(Array.from(data)));
    }
  }
}

// ============================================================================
// GERENCIAMENTO DE DADOS
// ============================================================================

class DataManager {
  static saveDailyEntry(entryData) {
    const { weight, date, calories, activityLevel, notes } = entryData;

    if (!weight || !date) {
      throw new Error('Por favor, preencha o peso e a data.');
    }

    try {
      if (db) {
        // Usar SQLite
        db.run(
          'INSERT OR REPLACE INTO weight_entries (user_id, date, weight, calories, activity_level, notes) VALUES (?, ?, ?, ?, ?, ?)',
          [currentUser, date, weight, calories, activityLevel, notes]
        );
        DatabaseManager.save();
      } else {
        // Usar fallback localStorage
        const entries = JSON.parse(localStorage.getItem(`weightEntries_${currentUser}`) || '[]');
        const existingIndex = entries.findIndex(e => e.date === date);
        const entry = { 
          date, 
          weight, 
          calories, 
          activity_level: activityLevel, 
          notes, 
          timestamp: new Date().toISOString() 
        };
        
        if (existingIndex >= 0) {
          entries[existingIndex] = entry;
        } else {
          entries.push(entry);
        }
        
        entries.sort((a, b) => new Date(b.date) - new Date(a.date));
        localStorage.setItem(`weightEntries_${currentUser}`, JSON.stringify(entries));
      }

      return true;
    } catch (error) {
      console.error('Erro ao salvar:', error);
      throw new Error('Erro ao salvar registro.');
    }
  }

  static getWeightEntries() {
    if (db) {
      try {
        const stmt = db.prepare('SELECT * FROM weight_entries WHERE user_id = ? ORDER BY date DESC');
        const entries = [];
        stmt.bind([currentUser]);
        while (stmt.step()) {
          entries.push(stmt.getAsObject());
        }
        stmt.free();
        return entries;
      } catch (error) {
        console.error('Erro ao buscar registros:', error);
        return [];
      }
    } else {
      return JSON.parse(localStorage.getItem(`weightEntries_${currentUser}`) || '[]');
    }
  }

  static deleteEntry(date) {
    try {
      if (db) {
        db.run('DELETE FROM weight_entries WHERE user_id = ? AND date = ?', [currentUser, date]);
        DatabaseManager.save();
      } else {
        const entries = JSON.parse(localStorage.getItem(`weightEntries_${currentUser}`) || '[]');
        const filteredEntries = entries.filter(e => e.date !== date);
        localStorage.setItem(`weightEntries_${currentUser}`, JSON.stringify(filteredEntries));
      }
      return true;
    } catch (error) {
      console.error('Erro ao excluir:', error);
      throw new Error('Erro ao excluir registro.');
    }
  }

  static loadUserProfile() {
    if (!db) return null;
    
    try {
      const stmt = db.prepare('SELECT * FROM user_profile WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1');
      stmt.bind([currentUser]);
      let profile = null;
      if (stmt.step()) {
        profile = stmt.getAsObject();
      }
      stmt.free();
      return profile;
    } catch (error) {
      console.error('Erro ao carregar perfil:', error);
      return null;
    }
  }

  static saveUserProfile(profileData) {
    if (!db) return false;
    
    const { height, age, gender, targetWeight, activityLevel, deficitStrategy } = profileData;

    try {
      db.run(
        'INSERT OR REPLACE INTO user_profile (user_id, height, age, gender, target_weight, activity_level, deficit_strategy, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
        [currentUser, height, age, gender, targetWeight, activityLevel, deficitStrategy]
      );
      DatabaseManager.save();
      return true;
    } catch (error) {
      console.error('Erro ao salvar perfil:', error);
      return false;
    }
  }
}

// ============================================================================
// CÁLCULOS E ANÁLISES
// ============================================================================

class CalculationEngine {
  static calculateBMR(weight, height, age, gender) {
    // Fórmula Mifflin-St Jeor
    if (gender === 'masculino') {
      return (10 * weight) + (6.25 * height) - (5 * age) + 5;
    } else {
      return (10 * weight) + (6.25 * height) - (5 * age) - 161;
    }
  }

  static calculateIMC(weight, height) {
    return weight / Math.pow(height / 100, 2);
  }

  static calculateStreak(entries) {
    if (entries.length === 0) return 0;
    
    let streak = 0;
    const today = new Date();
    
    for (let i = 0; i < entries.length; i++) {
      const entryDate = new Date(entries[i].date);
      const daysDiff = Math.floor((today - entryDate) / (1000 * 60 * 60 * 24));
      
      if (daysDiff === streak) {
        streak++;
      } else {
        break;
      }
    }
    
    return streak;
  }

  static calculateWeeklyAverage(entries) {
    if (entries.length < 2) return 0;
    
    const fourWeeksAgo = new Date();
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
    
    const recentEntries = entries.filter(entry => 
      new Date(entry.date) >= fourWeeksAgo
    );
    
    if (recentEntries.length < 2) return 0;
    
    const firstWeight = recentEntries[recentEntries.length - 1].weight;
    const lastWeight = recentEntries[0].weight;
    const daysDiff = Math.max(1, (new Date(recentEntries[0].date) - new Date(recentEntries[recentEntries.length - 1].date)) / (1000 * 60 * 60 * 24));
    
    return ((firstWeight - lastWeight) / daysDiff) * 7;
  }

  static calculateDaysToGoal(entries, targetWeight) {
    if (entries.length < 2) return '∞';
    
    const weeklyAvg = this.calculateWeeklyAverage(entries);
    if (weeklyAvg === 0) return '∞';
    
    const currentWeight = entries[0].weight;
    const weightToLose = currentWeight - targetWeight;
    
    if (weeklyAvg > 0 && weightToLose < 0) return '∞';
    if (weeklyAvg < 0 && weightToLose > 0) return '∞';
    
    const weeksNeeded = Math.abs(weightToLose / weeklyAvg);
    return Math.ceil(weeksNeeded * 7);
  }

  static calculateRealTDEE(entries) {
    const entriesWithCalories = entries.filter(e => e.calories && e.calories > 0);
    
    if (entriesWithCalories.length < CONFIG.MIN_DAYS_FOR_TDEE) {
      return { 
        tdee: null, 
        confidence: 'low', 
        reason: `Dados insuficientes (min ${CONFIG.MIN_DAYS_FOR_TDEE} dias com calorias)` 
      };
    }

    const sortedEntries = entriesWithCalories.sort((a, b) => new Date(a.date) - new Date(b.date));
    const analysisEntries = sortedEntries.slice(-Math.min(CONFIG.MAX_ANALYSIS_DAYS, sortedEntries.length));
    
    if (analysisEntries.length < CONFIG.MIN_DAYS_FOR_TDEE) {
      return { tdee: null, confidence: 'low', reason: 'Período muito curto' };
    }

    // Calcular mudança de peso no período
    const firstWeight = analysisEntries[0].weight;
    const lastWeight = analysisEntries[analysisEntries.length - 1].weight;
    const weightChange = lastWeight - firstWeight;
    
    // Calcular dias entre primeira e última medição
    const firstDate = new Date(analysisEntries[0].date);
    const lastDate = new Date(analysisEntries[analysisEntries.length - 1].date);
    const daysDiff = Math.max(1, (lastDate - firstDate) / (1000 * 60 * 60 * 24));
    
    // Calcular média de calorias consumidas por dia
    const totalCalories = analysisEntries.reduce((sum, entry) => sum + entry.calories, 0);
    const avgCaloriesPerDay = totalCalories / analysisEntries.length;
    
    // Calcular TDEE real
    const caloriesFromWeightChange = weightChange * CONFIG.CALORIES_PER_KG;
    const estimatedTDEE = avgCaloriesPerDay + (caloriesFromWeightChange / daysDiff);
    
    // Calcular confiança
    let confidence = 'medium';
    if (analysisEntries.length >= CONFIG.IDEAL_DAYS_FOR_TDEE) confidence = 'high';
    if (analysisEntries.length < 14) confidence = 'low';
    
    if (estimatedTDEE < CONFIG.REASONABLE_TDEE_MIN || estimatedTDEE > CONFIG.REASONABLE_TDEE_MAX) {
      confidence = 'low';
    }
    
    return {
      tdee: Math.round(estimatedTDEE),
      confidence: confidence,
      weightChange: weightChange.toFixed(2),
      daysPeriod: Math.round(daysDiff),
      avgCalories: Math.round(avgCaloriesPerDay),
      dataPoints: analysisEntries.length
    };
  }

  static calculateMetabolicAdaptation(entries, userProfile) {
    const realTDEEData = this.calculateRealTDEE(entries);
    
    if (!realTDEEData.tdee || !userProfile) return null;
    
    const currentWeight = entries[0]?.weight;
    if (!currentWeight) return null;
    
    // Calcular TDEE teórico
    const theoreticalBMR = this.calculateBMR(
      currentWeight, 
      userProfile.height, 
      userProfile.age, 
      userProfile.gender
    );
    const theoreticalTDEE = theoreticalBMR * userProfile.activity_level;
    
    // Calcular % de adaptação
    const adaptationPercent = ((realTDEEData.tdee - theoreticalTDEE) / theoreticalTDEE) * 100;
    
    return Math.round(adaptationPercent);
  }

  static gerarInsights(deficit, semanas, imcAtual, imcAlvo, isPerda, tdee) {
    const insights = [];
    const isInsightsWarning = deficit > 700 || semanas < 4;
    
    // Tentar obter dados do TDEE real
    const entries = DataManager.getWeightEntries();
    const realTDEEData = this.calculateRealTDEE(entries);
    const userProfile = DataManager.loadUserProfile();
    const adaptation = this.calculateMetabolicAdaptation(entries, userProfile);
   
    // Insights sobre o déficit
    if (deficit <= 300) {
      insights.push('Sua estratégia é conservadora e sustentável a longo prazo');
    } else if (deficit <= 500) {
      insights.push('Estratégia equilibrada entre resultados e sustentabilidade');
    } else if (deficit <= 700) {
      insights.push('Estratégia agressiva - monitore energia e humor');
    } else {
      insights.push('Estratégia muito agressiva - considere supervisão profissional');
    }

    // Insights sobre tempo
    if (semanas < 8) {
      insights.push('Meta de curto prazo - mantenha consistência máxima');
    } else if (semanas < 16) {
      insights.push('Prazo moderado - permita flexibilidade ocasional');
    } else {
      insights.push('Jornada longa - foque em criar hábitos sustentáveis');
    }

    // Insights sobre IMC
    if (imcAtual < 18.5) {
      insights.push('IMC atual indica baixo peso - considere ganho de massa');
    } else if (imcAtual >= 25 && imcAtual < 30) {
      insights.push('Redução do IMC pode trazer benefícios significativos à saúde');
    } else if (imcAtual >= 30) {
      insights.push('Perda de peso pode reduzir riscos de doenças crônicas');
    }

    // Insights sobre metabolismo
    if (realTDEEData && realTDEEData.tdee) {
      const realTDEE = realTDEEData.tdee;
      const diff = realTDEE - tdee;
      
      if (Math.abs(diff) < 100) {
        insights.push(`✅ Seu TDEE real (${realTDEE} kcal) está alinhado com a teoria`);
      } else if (diff > 100) {
        insights.push(`📈 Seu TDEE real (${realTDEE} kcal) é ${Math.round(diff)} kcal maior que estimado`);
      } else {
        insights.push(`📉 Seu TDEE real (${realTDEE} kcal) é ${Math.round(Math.abs(diff))} kcal menor que estimado`);
      }
      
      if (adaptation !== null) {
        if (adaptation < -10) {
          insights.push(`⚠️ Possível adaptação metabólica detectada (${adaptation}% menor)`);
        } else if (adaptation > 10) {
          insights.push(`🔥 Metabolismo acelerado detectado (${adaptation}% maior)`);
        }
      }
      
      insights.push(`📊 Baseado em ${realTDEEData.dataPoints} dias de dados (confiança: ${realTDEEData.confidence})`);
    } else {
      if (tdee > 2500) {
        insights.push('Seu gasto energético teórico é alto - aproveite para flexibilidade alimentar');
      } else if (tdee < 1800) {
        insights.push('Metabolismo teórico mais baixo - cada caloria conta mais');
      }
      
      insights.push('💡 Registre calorias diárias para ver seu TDEE real e adaptações metabólicas');
    }

    // Recomendações adicionais
    if (isPerda) {
      insights.push('Inclua treino de força para preservar massa muscular');
      insights.push('Hidrate-se bem e priorize 7-9h de sono por noite');
    } else {
      insights.push('Foque em proteínas (1.6-2.2g/kg) para ganho muscular');
      insights.push('Treine progressivamente e seja paciente com o processo');
    }

    const insightClass = isInsightsWarning ? 'insights warning' : 'insights';
    
    return `
      <div class="${insightClass}">
        <h4>💡 Insights Personalizados</h4>
        <ul>
          ${insights.map(insight => `<li>${insight}</li>`).join('')}
        </ul>
      </div>
    `;
  }
}

// ============================================================================
// INTERFACE E INTERAÇÕES
// ============================================================================

class UIManager {
  static updateProgress() {
    const entries = DataManager.getWeightEntries();
    
    if (entries.length === 0) {
      document.getElementById('streak').textContent = '0';
      document.getElementById('totalProgress').textContent = '📝 Adicione registros';
      document.getElementById('avgWeekly').textContent = '📊 Sem dados';
      document.getElementById('daysToGoal').textContent = '⏳ Registre seu peso';
      document.getElementById('realTDEE').textContent = '💡 Precisa de calorias';
      document.getElementById('metabolicAdaptation').textContent = '📈 Aguardando dados';
      return;
    }

    // Estatísticas básicas
    const streak = CalculationEngine.calculateStreak(entries);
    document.getElementById('streak').textContent = streak;

    const firstWeight = entries[entries.length - 1].weight;
    const lastWeight = entries[0].weight;
    const totalProgress = firstWeight - lastWeight;
    document.getElementById('totalProgress').textContent = `${totalProgress.toFixed(1)} kg`;

    const weeklyAvg = CalculationEngine.calculateWeeklyAverage(entries);
    if (entries.length < 2) {
      document.getElementById('avgWeekly').textContent = '📊 Precisa mais registros';
    } else if (weeklyAvg === 0) {
      document.getElementById('avgWeekly').textContent = '📈 Sem tendência ainda';
    } else {
      document.getElementById('avgWeekly').textContent = `${weeklyAvg.toFixed(2)} kg`;
    }

    const targetWeight = parseFloat(document.getElementById('targetWeight').value) || 70;
    const daysToGoal = CalculationEngine.calculateDaysToGoal(entries, targetWeight);
    if (entries.length < 2) {
      document.getElementById('daysToGoal').textContent = '⏳ Registre mais dias';
    } else if (daysToGoal === '∞') {
      document.getElementById('daysToGoal').textContent = '🔄 Sem tendência';
    } else {
      document.getElementById('daysToGoal').textContent = daysToGoal;
    }

    // TDEE real e adaptação metabólica
    const userProfile = DataManager.loadUserProfile();
    const realTDEEData = CalculationEngine.calculateRealTDEE(entries);
    
    // Mensagens específicas baseadas na quantidade de dados
    const entriesWithCalories = entries.filter(e => e.calories && e.calories > 0);
    
    if (realTDEEData.tdee) {
      document.getElementById('realTDEE').textContent = `${realTDEEData.tdee} kcal`;
    } else if (entriesWithCalories.length === 0) {
      document.getElementById('realTDEE').textContent = '💡 Registre calorias também';
    } else if (entriesWithCalories.length < CONFIG.MIN_DAYS_FOR_TDEE) {
      document.getElementById('realTDEE').textContent = `📊 ${entriesWithCalories.length}/${CONFIG.MIN_DAYS_FOR_TDEE} dias c/ calorias`;
    } else {
      document.getElementById('realTDEE').textContent = '⏳ Aguardando mais dados';
    }
    
    const adaptation = CalculationEngine.calculateMetabolicAdaptation(entries, userProfile);
    if (adaptation !== null) {
      document.getElementById('metabolicAdaptation').textContent = `${adaptation}%`;
    } else if (entriesWithCalories.length < CONFIG.MIN_DAYS_FOR_TDEE) {
      document.getElementById('metabolicAdaptation').textContent = '📈 Precisa mais dados';
    } else {
      document.getElementById('metabolicAdaptation').textContent = '🔄 Calculando...';
    }

    // Atualizar gráfico
    ChartManager.drawProgressChart(entries);
  }

  static loadHistory() {
    const entries = DataManager.getWeightEntries();
    const historyList = document.getElementById('historyList');
    
    if (entries.length === 0) {
      historyList.innerHTML = `
        <p class="text-center text-muted" style="padding: 2rem;">
          Nenhum registro encontrado. Comece registrando seu peso na aba de Progresso!
        </p>
      `;
      return;
    }
    
    historyList.innerHTML = entries.map(entry => {
      const caloriesInfo = entry.calories ? `<br/>📊 ${entry.calories} kcal` : '';
      const activityInfo = entry.activity_level ? `<br/>🏃 ${this.getActivityLabel(entry.activity_level)}` : '';
      
      return `
        <div class="history-item">
          <div>
            <strong>${new Date(entry.date).toLocaleDateString('pt-BR')}</strong>
            <div class="text-muted" style="font-size: 0.9rem;">
              ${entry.notes || 'Sem observações'}${caloriesInfo}${activityInfo}
            </div>
          </div>
          <div style="text-align: right;">
            <strong>${entry.weight} kg</strong>
            <button onclick="AppController.deleteEntry('${entry.date}')" style="margin-left: 1rem; padding: 0.25rem 0.5rem; background: #dc3545; width: auto;">🗑️</button>
          </div>
        </div>
      `;
    }).join('');
  }

  static getActivityLabel(activityLevel) {
    const labels = {
      'sedentary': 'Sedentário',
      'light': 'Leve',
      'moderate': 'Moderado',
      'intense': 'Intenso',
      'double': 'Duplo'
    };
    return labels[activityLevel] || activityLevel;
  }

  static showTab(tabName) {
    // Esconder todas as abas
    document.querySelectorAll('.tab-content').forEach(tab => {
      tab.classList.remove('active');
    });
    
    // Remover classe active de todos os botões
    document.querySelectorAll('.tab-button').forEach(btn => {
      btn.classList.remove('active');
    });
    
    // Mostrar aba selecionada
    document.getElementById(tabName).classList.add('active');
    event.target.classList.add('active');
    
    // Atualizar dados se necessário
    if (tabName === 'progress') {
      this.updateProgress();
    } else if (tabName === 'history') {
      this.loadHistory();
    }
  }

  static exportData() {
    const entries = DataManager.getWeightEntries();
    const csvContent = "data:text/csv;charset=utf-8," 
      + "Data,Peso,Calorias,Atividade,Observações\n"
      + entries.map(e => `${e.date},${e.weight},${e.calories || ''},${e.activity_level || ''},"${e.notes || ''}"`).join('\n');
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `historico_peso_${currentUser}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

// ============================================================================
// GRÁFICOS
// ============================================================================

class ChartManager {
  static drawProgressChart(entries) {
    const canvas = document.getElementById('progressChart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    
    // Limpar canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (entries.length < 2) {
      ctx.fillStyle = '#7f8c8d';
      ctx.font = '16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Adicione mais registros para ver o gráfico', canvas.width / 2, canvas.height / 2);
      return;
    }

    // Preparar dados (últimos 30 registros)
    const chartData = entries.slice(0, 30).reverse();
    const weights = chartData.map(e => e.weight);
    const minWeight = Math.min(...weights) - 1;
    const maxWeight = Math.max(...weights) + 1;
    
    const padding = 40;
    const chartWidth = canvas.width - 2 * padding;
    const chartHeight = canvas.height - 2 * padding;
    
    // Desenhar eixos
    ctx.strokeStyle = '#e1e8ed';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, canvas.height - padding);
    ctx.lineTo(canvas.width - padding, canvas.height - padding);
    ctx.stroke();
    
    // Desenhar linha de tendência
    ctx.strokeStyle = '#667eea';
    ctx.lineWidth = 2;
    ctx.beginPath();
    
    chartData.forEach((entry, index) => {
      const x = padding + (index / (chartData.length - 1)) * chartWidth;
      const y = canvas.height - padding - ((entry.weight - minWeight) / (maxWeight - minWeight)) * chartHeight;
      
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    
    ctx.stroke();
    
    // Desenhar pontos
    ctx.fillStyle = '#667eea';
    chartData.forEach((entry, index) => {
      const x = padding + (index / (chartData.length - 1)) * chartWidth;
      const y = canvas.height - padding - ((entry.weight - minWeight) / (maxWeight - minWeight)) * chartHeight;
      
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, 2 * Math.PI);
      ctx.fill();
    });
    
    // Labels
    ctx.fillStyle = '#7f8c8d';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${minWeight.toFixed(1)}kg`, padding, canvas.height - 5);
    ctx.fillText(`${maxWeight.toFixed(1)}kg`, padding, 15);
  }
}

// ============================================================================
// CONTROLADOR PRINCIPAL
// ============================================================================

class AppController {
  static async initialize() {
    // Inicializar banco de dados
    await DatabaseManager.initialize();
    
    // Carregar perfil do usuário
    this.loadUserProfile();
    
    // Configurar event listeners
    this.setupEventListeners();
    
    // Definir data atual
    document.getElementById('dailyDate').valueAsDate = new Date();
    
    // Atualizar interface
    UIManager.updateProgress();
    UIManager.loadHistory();
  }

  static loadUserProfile() {
    const profile = DataManager.loadUserProfile();
    if (profile) {
      if (profile.height) document.getElementById('height').value = profile.height;
      if (profile.age) document.getElementById('age').value = profile.age;
      if (profile.gender) document.getElementById('gender').value = profile.gender;
      if (profile.target_weight) document.getElementById('targetWeight').value = profile.target_weight;
      if (profile.activity_level) document.getElementById('activity').value = profile.activity_level;
      if (profile.deficit_strategy) document.getElementById('deficit').value = profile.deficit_strategy;
    }
  }

  static setupEventListeners() {
    // Formulário de cálculo
    document.getElementById('weightForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.calcular();
    });

    // Formulário diário
    document.getElementById('dailyForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveDailyEntry();
    });

    // Salvar perfil quando valores mudam (sem auto-calcular)
    let timeoutId;
    document.querySelectorAll('#weightForm input, #weightForm select').forEach(input => {
      input.addEventListener('input', () => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          if (this.hasRequiredFields()) {
            this.saveUserProfile();
          }
        }, 500);
      });
    });
  }

  static hasRequiredFields() {
    return document.getElementById('currentWeight').value && 
           document.getElementById('targetWeight').value && 
           document.getElementById('height').value && 
           document.getElementById('age').value;
  }

  static saveDailyEntry() {
    try {
      const entryData = {
        weight: parseFloat(document.getElementById('dailyWeight').value),
        date: document.getElementById('dailyDate').value,
        calories: parseInt(document.getElementById('dailyCalories').value) || null,
        activityLevel: document.getElementById('dailyActivity').value || null,
        notes: document.getElementById('dailyNotes').value
      };

      DataManager.saveDailyEntry(entryData);

      // Limpar formulário
      document.getElementById('dailyWeight').value = '';
      document.getElementById('dailyCalories').value = '';
      document.getElementById('dailyActivity').value = '';
      document.getElementById('dailyNotes').value = '';
      document.getElementById('dailyDate').valueAsDate = new Date();

      // Atualizar displays
      UIManager.updateProgress();
      UIManager.loadHistory();
      
      // Atualizar peso atual na calculadora se for de hoje
      const today = new Date().toISOString().split('T')[0];
      if (entryData.date === today) {
        document.getElementById('currentWeight').value = entryData.weight;
        this.calcular();
      }

      alert('✅ Registro salvo com sucesso!');
      
    } catch (error) {
      alert(`❌ ${error.message}`);
    }
  }

  static deleteEntry(date) {
    if (!confirm('Tem certeza que deseja excluir este registro?')) return;
    
    try {
      DataManager.deleteEntry(date);
      UIManager.updateProgress();
      UIManager.loadHistory();
      alert('✅ Registro excluído com sucesso!');
    } catch (error) {
      alert(`❌ ${error.message}`);
    }
  }

  static saveUserProfile() {
    const profileData = {
      height: parseFloat(document.getElementById('height').value),
      age: parseInt(document.getElementById('age').value),
      gender: document.getElementById('gender').value,
      targetWeight: parseFloat(document.getElementById('targetWeight').value),
      activityLevel: parseFloat(document.getElementById('activity').value),
      deficitStrategy: parseInt(document.getElementById('deficit').value)
    };

    DataManager.saveUserProfile(profileData);
  }

  static calcular() {
    // Capturar valores dos inputs
    const pesoAtual = parseFloat(document.getElementById('currentWeight').value);
    const pesoAlvo = parseFloat(document.getElementById('targetWeight').value);
    const altura = parseFloat(document.getElementById('height').value);
    const idade = parseInt(document.getElementById('age').value);
    const genero = document.getElementById('gender').value;
    const deficitDiario = parseInt(document.getElementById('deficit').value);
    const fatorAtividade = parseFloat(document.getElementById('activity').value);

    // Limpar resultados anteriores
    const output = document.getElementById('output');
    output.style.display = 'none';
    output.innerHTML = '';

    // Validações
    if (!pesoAtual || !pesoAlvo || !altura || !idade) {
      alert('Por favor, preencha todos os campos obrigatórios.');
      return;
    }

    // Calcular BMR usando CalculationEngine
    const bmr = CalculationEngine.calculateBMR(pesoAtual, altura, idade, genero);
    const tdee = bmr * fatorAtividade;

    // Calcular IMC atual e alvo
    const imcAtual = CalculationEngine.calculateIMC(pesoAtual, altura);
    const imcAlvo = CalculationEngine.calculateIMC(pesoAlvo, altura);

    // Determinar se é perda ou ganho de peso
    const diferencaPeso = pesoAtual - pesoAlvo;
    const isPerda = diferencaPeso > 0;
    const tipoObjetivo = isPerda ? 'Perda' : 'Ganho';

    // Calcular projeções baseadas no TDEE real
    // Para perda: déficit positivo (comer menos que TDEE)
    // Para ganho: superávit positivo (comer mais que TDEE)
    const caloriasDiariasAlvo = tdee + (isPerda ? -deficitDiario : deficitDiario);
    const deficitRealDiario = Math.abs(tdee - caloriasDiariasAlvo);
    const mudancaPorSemana = (deficitRealDiario * 7) / CONFIG.CALORIES_PER_KG;
    
    // Para ganho de peso, a mudança deve ser positiva
    const mudancaPorSemanaFinal = isPerda ? -mudancaPorSemana : mudancaPorSemana;
    const semanasNecessarias = Math.abs(diferencaPeso) / mudancaPorSemana;
    const mesesNecessarios = semanasNecessarias / 4.33;

    // Calcular data estimada
    const hoje = new Date();
    const dataFinal = new Date(hoje.getTime());
    dataFinal.setDate(hoje.getDate() + Math.round(semanasNecessarias * 7));

    if (Math.abs(diferencaPeso) < 0.1) {
      output.innerHTML = `
        <div class="result-header">✅ Objetivo Alcançado!</div>
        <p>Você já está no seu peso alvo! Foque na manutenção.</p>
      `;
      output.style.display = 'block';
      return;
    }

    // Gerar insights personalizados
    const insights = CalculationEngine.gerarInsights(deficitDiario, semanasNecessarias, imcAtual, imcAlvo, isPerda, tdee);

    output.innerHTML = `
      <div class="result-header">
        📊 ${tipoObjetivo} de Peso - Plano Personalizado
      </div>
       <!-- Seção: Projeções -->
        <div class="result-section" style="background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%);">
          <h4 style="color: #1976d2;">🎯 Projeções</h4>
          <div class="result-line">
            <span class="result-label">⏱️ Tempo estimado:</span>
            <span class="result-value">${Math.ceil(semanasNecessarias)} semanas (${mesesNecessarios.toFixed(1)} meses)</span>
          </div>
          <div class="result-line">
            <span class="result-label">📅 Data estimada:</span>
            <span class="result-value">${dataFinal.toLocaleDateString('pt-BR')}</span>
          </div>
          <div class="result-line">
            <span class="result-label">⚖️ Mudança por semana:</span>
            <span class="result-value">${mudancaPorSemanaFinal.toFixed(2)} kg</span>
          </div>
          <div class="result-line">
            <span class="result-label">📈 Mudança por mês:</span>
            <span class="result-value">${(mudancaPorSemanaFinal * 4.33).toFixed(2)} kg</span>
          </div>
          <div class="result-line">
            <span class="result-label">🏁 Mudança total:</span>
            <span class="result-value">${Math.abs(diferencaPeso).toFixed(1)} kg (${((Math.abs(diferencaPeso) / pesoAtual) * 100).toFixed(1)}%)</span>
          </div>
        </div>
      </div>
      <div class="results-grid">
        <!-- Seção: Dados Metabólicos -->
        <div class="result-section" style="background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);">
          <h4 style="color: #495057;">⚡ Seu Metabolismo</h4>
          <div class="result-line">
            <span class="result-label">🔥 Taxa Metabólica Basal (TMB):</span>
            <span class="result-value">${bmr.toFixed(0)} kcal/dia</span>
          </div>
          <div class="result-line">
            <span class="result-label">💪 Gasto Total Diário (TDEE):</span>
            <span class="result-value">${tdee.toFixed(0)} kcal/dia</span>
          </div>
          <div class="result-line">
            <span class="result-label">🍽️ Calorias para ${isPerda ? 'perder' : 'ganhar'} peso:</span>
            <span class="result-value">${caloriasDiariasAlvo.toFixed(0)} kcal/dia</span>
          </div>
          <div class="result-line">
            <span class="result-label">${isPerda ? '🔻' : '🔺'} ${isPerda ? 'Déficit' : 'Superávit'} calórico:</span>
            <span class="result-value">${deficitRealDiario} kcal/dia</span>
          </div>
        </div>    
      <!-- Seção: Indicadores de Saúde -->
      <div class="results-grid single-column">
        <div class="result-section" style="background: linear-gradient(135deg, #f3e5f5 0%, #e1bee7 100%);">
          <h4 style="color: #7b1fa2;">📊 Indicadores de Saúde</h4>
          <div class="result-line">
            <span class="result-label">📏 IMC atual → alvo:</span>
            <span class="result-value">${imcAtual.toFixed(1)} → ${imcAlvo.toFixed(1)} kg/m²</span>
          </div>
        </div>
      </div>
      
      <div class="progress-bar">
        <div class="progress-fill" style="width: 0%"></div>
      </div>
      
      ${insights}
      
      <small style="color: #6c757d; font-style: italic; display: block; margin-top: 1rem;">
        ⚠️ Esta projeção é uma estimativa baseada em modelos científicos. Resultados podem variar devido a fatores individuais, adaptações metabólicas e aderência ao plano.
      </small>
    `;

    output.style.display = 'block';
  }
}

// ============================================================================
// FUNÇÕES GLOBAIS PARA COMPATIBILIDADE
// ============================================================================

// Funções expostas globalmente para uso nos event handlers HTML
window.showTab = (tabName) => UIManager.showTab(tabName);
window.exportData = () => UIManager.exportData();
window.AppController = AppController;

// Inicializar aplicação quando página carregar
window.addEventListener('load', () => {
  AppController.initialize();
}); 