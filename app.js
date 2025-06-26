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
      UIManager.updateProgress();
    } else if (tabName === 'history') {
      UIManager.loadHistory();
    } else if (tabName === 'macros') {
      AppController.updateMacros();
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
  // Helper para formatar data no formato YYYY-MM-DD sem problemas de timezone
  static formatDateToString(date) {
    return date.getFullYear() + '-' + 
           String(date.getMonth() + 1).padStart(2, '0') + '-' + 
           String(date.getDate()).padStart(2, '0');
  }
  static async initialize() {
    // Inicializar banco de dados
    await DatabaseManager.initialize();
    
    // Carregar perfil do usuário
    this.loadUserProfile();
    
    // Configurar event listeners
    this.setupEventListeners();
    
    // Definir data atual
    document.getElementById('dailyDate').value = this.formatDateToString(new Date());
    
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
      document.getElementById('dailyDate').value = this.formatDateToString(new Date());

      // Atualizar displays
      UIManager.updateProgress();
      UIManager.loadHistory();
      
      // Atualizar peso atual na calculadora se for de hoje
      const todayString = this.formatDateToString(new Date());
      if (entryData.date === todayString) {
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

      <!-- Seção de Análise Detalhada -->
      <div class="detailed-analysis">
        <div class="analysis-grid">
          <!-- Card de Calorias de Manutenção -->
          <div class="analysis-card maintenance-card">
            <h4>Suas Calorias de Manutenção</h4>
            <div class="big-number">${Math.round(tdee)}</div>
            <div class="subtitle">calorias por dia</div>
            <div class="weekly-calories">${Math.round(tdee * 7).toLocaleString()}</div>
            <div class="subtitle">calorias por semana</div>
          </div>

          <!-- Tabela de Níveis de Atividade -->
          <div class="analysis-card activity-table">
            <h4>Comparação de Níveis de Atividade</h4>
            <p style="margin-bottom: 1rem; color: #666; font-size: 0.9rem;">
              Baseado na fórmula Mifflin-St Jeor. A tabela mostra a diferença se você tivesse selecionado um nível diferente.
            </p>
            <div class="activity-comparison">
              <div class="activity-row">
                <span class="activity-label">Taxa Metabólica Basal</span>
                <span class="activity-value">${Math.round(bmr)} kcal/dia</span>
              </div>
              <div class="activity-row ${fatorAtividade === 1.2 ? 'current-activity' : ''}">
                <span class="activity-label">Sedentário</span>
                <span class="activity-value">${Math.round(bmr * 1.2)} kcal/dia</span>
              </div>
              <div class="activity-row ${fatorAtividade === 1.375 ? 'current-activity' : ''}">
                <span class="activity-label">Exercício Leve</span>
                <span class="activity-value">${Math.round(bmr * 1.375)} kcal/dia</span>
              </div>
              <div class="activity-row ${fatorAtividade === 1.55 ? 'current-activity' : ''}">
                <span class="activity-label">Exercício Moderado</span>
                <span class="activity-value">${Math.round(bmr * 1.55)} kcal/dia</span>
              </div>
              <div class="activity-row ${fatorAtividade === 1.725 ? 'current-activity' : ''}">
                <span class="activity-label">Exercício Intenso</span>
                <span class="activity-value">${Math.round(bmr * 1.725)} kcal/dia</span>
              </div>
              <div class="activity-row ${fatorAtividade === 1.9 ? 'current-activity' : ''}">
                <span class="activity-label">Atleta</span>
                <span class="activity-value">${Math.round(bmr * 1.9)} kcal/dia</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Seção de IMC e Peso Ideal -->
        <div class="analysis-grid">
          <!-- IMC Score -->
          <div class="analysis-card bmi-card">
            <h4>Score IMC: ${CalculationEngine.calculateIMC(pesoAtual, altura).toFixed(1)}</h4>
            <p style="margin-bottom: 1rem;">
              Seu IMC é <strong>${CalculationEngine.calculateIMC(pesoAtual, altura).toFixed(1)}</strong>, 
              o que significa que você está classificado como <strong>${AppController.getIMCCategory(CalculationEngine.calculateIMC(pesoAtual, altura))}</strong>.
            </p>
            <div class="imc-table">
              <div class="imc-row ${CalculationEngine.calculateIMC(pesoAtual, altura) < 18.5 ? 'current-imc' : ''}">
                <span>18.5 ou menos</span>
                <span>Abaixo do peso</span>
              </div>
              <div class="imc-row ${CalculationEngine.calculateIMC(pesoAtual, altura) >= 18.5 && CalculationEngine.calculateIMC(pesoAtual, altura) < 25 ? 'current-imc' : ''}">
                <span>18.5 - 24.99</span>
                <span>Peso Normal</span>
              </div>
              <div class="imc-row ${CalculationEngine.calculateIMC(pesoAtual, altura) >= 25 && CalculationEngine.calculateIMC(pesoAtual, altura) < 30 ? 'current-imc' : ''}">
                <span>25 - 29.99</span>
                <span>Sobrepeso</span>
              </div>
              <div class="imc-row ${CalculationEngine.calculateIMC(pesoAtual, altura) >= 30 ? 'current-imc' : ''}">
                <span>30+</span>
                <span>Obesidade</span>
              </div>
            </div>
          </div>

          <!-- Peso Ideal -->
          <div class="analysis-card ideal-weight-card">
            <h4>Peso Ideal: ${AppController.calculateIdealWeightRange(altura)}</h4>
            <p style="margin-bottom: 1rem; color: #666; font-size: 0.9rem;">
              Seu peso ideal é <strong>estimado</strong> baseado em várias fórmulas listadas abaixo. 
              Essas fórmulas são baseadas na sua altura e representam médias, então não as leve 
              <em>muito a sério</em>, <strong>especialmente se você faz musculação</strong>.
            </p>
            <div class="weight-formulas">
              <div class="formula-row">
                <span class="formula-name">G.J. Hamwi (1964)</span>
                <span class="formula-weight">${AppController.calculateHamwi(altura, genero)} kg</span>
              </div>
              <div class="formula-row">
                <span class="formula-name">B.J. Devine (1974)</span>
                <span class="formula-weight">${AppController.calculateDevine(altura, genero)} kg</span>
              </div>
              <div class="formula-row">
                <span class="formula-name">J.D. Robinson (1983)</span>
                <span class="formula-weight">${AppController.calculateRobinson(altura, genero)} kg</span>
              </div>
              <div class="formula-row">
                <span class="formula-name">D.R. Miller (1983)</span>
                <span class="formula-weight">${AppController.calculateMiller(altura, genero)} kg</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <small style="color: #6c757d; font-style: italic; display: block; margin-top: 1rem;">
        ⚠️ Esta projeção é uma estimativa baseada em modelos científicos. Resultados podem variar devido a fatores individuais, adaptações metabólicas e aderência ao plano.
      </small>
    `;

    output.style.display = 'block';
  }

  static getIMCCategory(imc) {
    if (imc < 18.5) return 'Abaixo do peso';
    if (imc < 25) return 'Peso Normal';
    if (imc < 30) return 'Sobrepeso';
    return 'Obesidade';
  }

  static calculateIdealWeightRange(altura) {
    const hamwi = AppController.calculateHamwi(altura, 'masculino');
    const devine = AppController.calculateDevine(altura, 'masculino');
    const robinson = AppController.calculateRobinson(altura, 'masculino');
    const miller = AppController.calculateMiller(altura, 'masculino');
    
    const weights = [hamwi, devine, robinson, miller];
    const min = Math.min(...weights);
    const max = Math.max(...weights);
    
    return `${Math.round(min)}-${Math.round(max)} kg`;
  }

  static calculateHamwi(altura, genero) {
    const heightInches = altura / 2.54;
    const baseWeight = genero === 'masculino' ? 48 : 45.5;
    const increment = genero === 'masculino' ? 2.7 : 2.2;
    return Math.round(baseWeight + (heightInches - 60) * increment);
  }

  static calculateDevine(altura, genero) {
    const heightInches = altura / 2.54;
    const baseWeight = genero === 'masculino' ? 50 : 45.5;
    const increment = genero === 'masculino' ? 2.3 : 2.3;
    return Math.round(baseWeight + (heightInches - 60) * increment);
  }

  static calculateRobinson(altura, genero) {
    const heightInches = altura / 2.54;
    const baseWeight = genero === 'masculino' ? 52 : 49;
    const increment = genero === 'masculino' ? 1.9 : 1.7;
    return Math.round(baseWeight + (heightInches - 60) * increment);
  }

  static calculateMiller(altura, genero) {
    const heightInches = altura / 2.54;
    const baseWeight = genero === 'masculino' ? 56.2 : 53.1;
    const increment = genero === 'masculino' ? 1.41 : 1.36;
    return Math.round(baseWeight + (heightInches - 60) * increment);
  }

  static updateMacros() {
    const macroGoal = document.getElementById('macroGoal').value;
    const macroStyle = document.getElementById('macroStyle').value;
    const macroResults = document.getElementById('macroResults');

    // Mostrar/esconder configuração personalizada
    const customMacros = document.getElementById('customMacros');
    customMacros.style.display = macroStyle === 'custom' ? 'block' : 'none';

    // Verificar se temos dados básicos
    const pesoAtual = parseFloat(document.getElementById('currentWeight').value);
    const altura = parseFloat(document.getElementById('height').value);
    const idade = parseInt(document.getElementById('age').value);
    const genero = document.getElementById('gender').value;
    const fatorAtividade = parseFloat(document.getElementById('activity').value);
    const deficitDiario = parseInt(document.getElementById('deficit').value);

    if (!pesoAtual || !altura || !idade) {
      macroResults.innerHTML = `
        <p class="text-center text-muted" style="padding: 2rem;">
          Configure seus dados na aba Calculadora primeiro para ver as recomendações de macros!
        </p>
      `;
      return;
    }

    // Calcular calorias baseado no objetivo
    const bmr = CalculationEngine.calculateBMR(pesoAtual, altura, idade, genero);
    const tdee = bmr * fatorAtividade;
    
    let targetCalories;
    let goalDescription;
    
    switch (macroGoal) {
      case 'maintenance':
        targetCalories = tdee;
        goalDescription = 'manutenção';
        break;
      case 'cutting':
        const pesoAlvo = parseFloat(document.getElementById('targetWeight').value) || pesoAtual - 5;
        const isPerda = pesoAtual > pesoAlvo;
        targetCalories = tdee - (isPerda ? deficitDiario : -deficitDiario);
        goalDescription = `cutting (déficit de ${deficitDiario} kcal/dia)`;
        break;
      case 'bulking':
        targetCalories = tdee + deficitDiario;
        goalDescription = `bulking (superávit de ${deficitDiario} kcal/dia)`;
        break;
    }

    // Obter percentuais dos macros
    const macroPercentages = this.getMacroPercentages(macroStyle);
    
    // Validar percentuais customizados
    if (macroStyle === 'custom') {
      const proteinPercent = parseInt(document.getElementById('proteinPercent').value) || 30;
      const fatPercent = parseInt(document.getElementById('fatPercent').value) || 35;
      const carbPercent = parseInt(document.getElementById('carbPercent').value) || 35;
      
      const total = proteinPercent + fatPercent + carbPercent;
      const warningElement = document.getElementById('percentageWarning');
      
      if (total !== 100) {
        warningElement.style.display = 'block';
        macroPercentages.protein = proteinPercent;
        macroPercentages.fat = fatPercent;
        macroPercentages.carb = carbPercent;
      } else {
        warningElement.style.display = 'none';
        macroPercentages.protein = proteinPercent;
        macroPercentages.fat = fatPercent;
        macroPercentages.carb = carbPercent;
      }
    }

    // Calcular gramas dos macros
    const proteinGrams = Math.round((targetCalories * macroPercentages.protein / 100) / 4);
    const fatGrams = Math.round((targetCalories * macroPercentages.fat / 100) / 9);
    const carbGrams = Math.round((targetCalories * macroPercentages.carb / 100) / 4);

    // Exibir resultados
    macroResults.innerHTML = `
      <div class="calories-info">
        <h4>🎯 Suas Metas de ${goalDescription.charAt(0).toUpperCase() + goalDescription.slice(1)}</h4>
        <p>
          <strong>${Math.round(targetCalories)} calorias por dia</strong><br/>
          TDEE: ${Math.round(tdee)} kcal | ${macroGoal === 'maintenance' ? 'Sem déficit/superávit' : 
            (macroGoal === 'cutting' ? `Déficit: ${deficitDiario} kcal` : `Superávit: ${deficitDiario} kcal`)}
        </p>
      </div>

      <div class="macro-grid">
        <div class="macro-item">
          <h5>🥩 Proteína</h5>
          <div class="macro-value">${proteinGrams}<span class="macro-unit">g</span></div>
          <div class="macro-percentage">${macroPercentages.protein}%</div>
        </div>
        
        <div class="macro-item">
          <h5>🥑 Gordura</h5>
          <div class="macro-value">${fatGrams}<span class="macro-unit">g</span></div>
          <div class="macro-percentage">${macroPercentages.fat}%</div>
        </div>
        
        <div class="macro-item">
          <h5>🍞 Carboidrato</h5>
          <div class="macro-value">${carbGrams}<span class="macro-unit">g</span></div>
          <div class="macro-percentage">${macroPercentages.carb}%</div>
        </div>
      </div>

            <div style="background: #f8f9fa; padding: 1rem; border-radius: 8px; margin-top: 2rem; text-align: center;">
        <small style="color: #6c757d;">
          💡 <strong>Dica:</strong> 1g de proteína e carboidrato = 4 kcal | 1g de gordura = 9 kcal
        </small>
      </div>
    `;
  }

  static getMacroPercentages(style) {
    const styles = {
      'balanced': { protein: 30, fat: 35, carb: 35 },
      'lowcarb': { protein: 40, fat: 40, carb: 20 },
      'highcarb': { protein: 30, fat: 20, carb: 50 },
      'keto': { protein: 35, fat: 60, carb: 5 }
    };
    
    return styles[style] || styles.balanced;
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